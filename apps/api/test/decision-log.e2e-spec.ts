import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DecisionLogService } from '../src/decisions/decision-log.service';
import { AgentDecisionStep } from '../src/entities/agent-decision-step.enum';
import { AgentDecision } from '../src/entities/agent-decision.entity';
import { CafeTable } from '../src/entities/cafe-table.entity';
import { Cafe } from '../src/entities/cafe.entity';
import { Slot } from '../src/entities/slot.entity';
import { createTestApp, truncateAll } from './utils/test-app';

const SLOT_PRICE_MINOR = 4000;

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken as string;
}

interface GateFixture {
  cafeId: string;
  tableId: string;
  slotIds: string[];
}

/** A café with `n` slots on the same table, each a day apart — outside the 10-hour booking-window rule. */
async function seedGateFixture(app: INestApplication, n: number): Promise<GateFixture> {
  const dataSource = app.get(DataSource);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);

  const cafe = await cafeRepo.save(
    cafeRepo.create({ name: 'Decision Café', area: 'Hauz Khas', description: 'fixture' }),
  );
  const table = await tableRepo.save(tableRepo.create({ cafeId: cafe.id, label: 'T1', capacity: 2 }));

  const slotIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const slotTime = new Date(Date.UTC(2026, 8, 10, 9, 0, 0) + i * 24 * 60 * 60 * 1000);
    const slot = await slotRepo.save(slotRepo.create({ cafeId: cafe.id, slotTime, priceMinor: SLOT_PRICE_MINOR }));
    slotIds.push(slot.id);
  }
  return { cafeId: cafe.id, tableId: table.id, slotIds };
}

const WIDE_WINDOW = {
  windowStart: '2026-09-01T00:00:00.000Z',
  windowEnd: '2026-10-01T00:00:00.000Z',
};

async function grantMandate(
  app: INestApplication,
  token: string,
  overrides: Partial<{
    maxPerBookingMinor: number;
    maxTotalMinor: number;
    maxBookings: number;
    allowedLocalities: string[];
    windowStart: string;
    windowEnd: string;
  }> = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/mandates')
    .set('Authorization', `Bearer ${token}`)
    .send({
      maxPerBookingMinor: SLOT_PRICE_MINOR,
      maxTotalMinor: SLOT_PRICE_MINOR * 10,
      maxBookings: 10,
      allowedLocalities: ['Hauz Khas'],
      ...WIDE_WINDOW,
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

async function hold(app: INestApplication, token: string, fixture: GateFixture, slotIndex: number): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: fixture.tableId, slotId: fixture.slotIds[slotIndex] })
    .expect(201);
  return res.body.holdId as string;
}

function confirm(
  app: INestApplication,
  token: string,
  fixture: GateFixture,
  slotIndex: number,
  holdId: string,
  mandateId: string,
  idempotencyKey?: string,
): request.Test {
  const req = request(app.getHttpServer())
    .post('/reservations/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ holdId, tableId: fixture.tableId, slotId: fixture.slotIds[slotIndex], mandateId });
  return idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req;
}

function trace(app: INestApplication, token: string, mandateId: string): request.Test {
  return request(app.getHttpServer())
    .get('/agent/decisions')
    .query({ mandateId })
    .set('Authorization', `Bearer ${token}`);
}

/**
 * Issue #6 (PRD area C): every mandate-bound propose/authorize/confirm is
 * recorded with what it asked for and what it got, including refusals, and
 * is readable back as one ordered trace per mandate.
 */
describe('Agent decision log (e2e)', () => {
  let app: INestApplication;
  let fixture: GateFixture;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    fixture = await seedGateFixture(app, 5);
  });

  afterAll(async () => {
    await app.close();
  });

  it('records a PROPOSE decision on an allowing preview, carrying the requested action and constraint snapshot', async () => {
    const token = await signup(app, 'propose-allow@example.com');
    const mandateId = await grantMandate(app, token);

    await request(app.getHttpServer())
      .post(`/mandates/${mandateId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
      .expect(201);

    const res = await trace(app, token, mandateId).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      mandateId,
      step: 'propose',
      verdict: 'ALLOW',
      denyReason: null,
      holdId: null,
      paymentId: null,
      razorpayOrderId: null,
    });
    expect(res.body[0].requestedAction).toMatchObject({ amountMinor: SLOT_PRICE_MINOR, locality: 'Hauz Khas' });
    expect(res.body[0].constraintsSnap).toMatchObject({ consumedMinor: 0, consumedBookings: 0 });
    expect(typeof res.body[0].latencyMs).toBe('number');
  });

  it('records a PROPOSE decision with its deny reason on a denying preview, and mutates nothing', async () => {
    const token = await signup(app, 'propose-deny@example.com');
    const mandateId = await grantMandate(app, token, { allowedLocalities: ['GK-II'] });

    await request(app.getHttpServer())
      .post(`/mandates/${mandateId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
      .expect(201);

    const res = await trace(app, token, mandateId).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ step: 'propose', verdict: 'DENY', denyReason: 'locality_mismatch' });
  });

  it('records AUTHORIZE and CONFIRM decisions carrying the hold, payment and idempotency identifiers for a successful confirm', async () => {
    const token = await signup(app, 'confirm-allow@example.com');
    const mandateId = await grantMandate(app, token);
    const holdId = await hold(app, token, fixture, 0);
    const idempotencyKey = 'confirm-key-1';

    await confirm(app, token, fixture, 0, holdId, mandateId, idempotencyKey).expect(201);

    const res = await trace(app, token, mandateId).expect(200);
    expect(res.body).toHaveLength(2);
    const [authorize, confirmDecision] = res.body;
    expect(authorize).toMatchObject({ step: 'authorize', verdict: 'ALLOW', denyReason: null, holdId, idempotencyKey });
    expect(confirmDecision).toMatchObject({ step: 'confirm', verdict: 'ALLOW', denyReason: null, holdId, idempotencyKey });
    expect(typeof authorize.paymentId).toBe('string');
    expect(authorize.paymentId).toEqual(confirmDecision.paymentId);
    expect(authorize.razorpayOrderId).toBeNull();
  });

  it('records a DENY AUTHORIZE decision that survives the transaction rollback it caused, with no reservation left behind', async () => {
    const token = await signup(app, 'confirm-deny@example.com');
    const mandateId = await grantMandate(app, token, { maxPerBookingMinor: SLOT_PRICE_MINOR - 1 });
    const holdId = await hold(app, token, fixture, 0);

    await confirm(app, token, fixture, 0, holdId, mandateId).expect(403);

    const res = await trace(app, token, mandateId).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      step: 'authorize',
      verdict: 'DENY',
      denyReason: 'per_booking_ceiling_exceeded',
      holdId,
      paymentId: null,
    });

    const mine = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body).toHaveLength(0);
  });

  it("freezes the constraint snapshot at decision time — an earlier decision's snapshot does not reflect later consumption", async () => {
    const token = await signup(app, 'snapshot@example.com');
    const mandateId = await grantMandate(app, token, { maxBookings: 5, maxTotalMinor: SLOT_PRICE_MINOR * 5 });

    const firstHold = await hold(app, token, fixture, 0);
    await confirm(app, token, fixture, 0, firstHold, mandateId).expect(201);

    const secondHold = await hold(app, token, fixture, 1);
    await confirm(app, token, fixture, 1, secondHold, mandateId).expect(201);

    const status = await request(app.getHttpServer())
      .get(`/mandates/${mandateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.consumedMinor).toBe(SLOT_PRICE_MINOR * 2);

    const res = await trace(app, token, mandateId).expect(200);
    const decisions = res.body as { step: string; constraintsSnap: { consumedMinor: number } }[];
    const firstConfirm = decisions.find((d) => d.step === 'confirm');
    expect(firstConfirm?.constraintsSnap.consumedMinor).toBe(SLOT_PRICE_MINOR);
    expect(firstConfirm?.constraintsSnap.consumedMinor).not.toBe(status.body.consumedMinor);
  });

  it('returns the trace in order across a preview, an authorize and a confirm', async () => {
    const token = await signup(app, 'order@example.com');
    const mandateId = await grantMandate(app, token);

    await request(app.getHttpServer())
      .post(`/mandates/${mandateId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
      .expect(201);

    const holdId = await hold(app, token, fixture, 0);
    await confirm(app, token, fixture, 0, holdId, mandateId).expect(201);

    const res = await trace(app, token, mandateId).expect(200);
    expect((res.body as { step: string }[]).map((d) => d.step)).toEqual(['propose', 'authorize', 'confirm']);
  });

  it("rejects reading another user's mandate trace", async () => {
    const owner = await signup(app, 'owner@example.com');
    const stranger = await signup(app, 'stranger@example.com');
    const mandateId = await grantMandate(app, owner);

    await trace(app, stranger, mandateId).expect(403);
  });

  it('does not log search or availability steps', async () => {
    const token = await signup(app, 'discover@example.com');
    const mandateId = await grantMandate(app, token);

    await request(app.getHttpServer()).get(`/cafes/${fixture.cafeId}/availability`).query({ date: '2026-09-10' }).expect(200);

    const res = await trace(app, token, mandateId).expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('a decision written inside a transaction rolls back with it', async () => {
    const token = await signup(app, 'txn-rollback@example.com');
    const mandateId = await grantMandate(app, token);
    const dataSource = app.get(DataSource);
    const decisionLog = app.get(DecisionLogService);

    await expect(
      dataSource.transaction(async (manager) => {
        await decisionLog.record(manager, {
          mandateId,
          step: AgentDecisionStep.AUTHORIZE,
          verdict: 'ALLOW',
          denyReason: null,
          requestedAction: { amountMinor: SLOT_PRICE_MINOR, locality: 'Hauz Khas', slotTime: new Date().toISOString() },
          constraintsSnap: { consumedMinor: 0 },
          latencyMs: 1,
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const rows = await dataSource.getRepository(AgentDecision).find({ where: { mandateId } });
    expect(rows).toHaveLength(0);
  });
});
