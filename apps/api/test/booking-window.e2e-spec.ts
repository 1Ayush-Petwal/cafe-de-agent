import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AgentWorkerService } from '../src/agent/agent-worker.service';
import { AgentLlmClient, ScriptedTurn } from '../src/agent/llm/agent-llm.client';
import { AgentWorkflowStatus } from '../src/entities/agent-workflow-status.enum';
import { AgentWorkflow } from '../src/entities/agent-workflow.entity';
import { CafeTable } from '../src/entities/cafe-table.entity';
import { Cafe } from '../src/entities/cafe.entity';
import { Slot } from '../src/entities/slot.entity';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken;
}

/** Adds a slot at an arbitrary time to an existing café (the fixture only seeds one). */
async function addSlot(app: INestApplication, cafeId: string, slotTime: Date): Promise<string> {
  const slotRepo = app.get(DataSource).getRepository(Slot);
  const slot = await slotRepo.save(slotRepo.create({ cafeId, slotTime }));
  return slot.id;
}

/** Adds a second, fully independent café with one table and one slot. */
async function addCafe(app: INestApplication, slotTime: Date): Promise<{ cafeId: string; tableId: string; slotId: string }> {
  const ds = app.get(DataSource);
  const cafe = await ds
    .getRepository(Cafe)
    .save(ds.getRepository(Cafe).create({ name: 'Second Café', area: 'Hauz Khas', description: 'other' }));
  const table = await ds
    .getRepository(CafeTable)
    .save(ds.getRepository(CafeTable).create({ cafeId: cafe.id, label: 'S1', capacity: 2 }));
  const slot = await ds.getRepository(Slot).save(ds.getRepository(Slot).create({ cafeId: cafe.id, slotTime }));
  return { cafeId: cafe.id, tableId: table.id, slotId: slot.id };
}

function book(app: INestApplication, token: string, tableId: string, slotId: string) {
  return request(app.getHttpServer())
    .post('/reservations')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, slotId });
}

/**
 * Issue #17 (PRD area B): one active reservation per user per café within any
 * rolling 10-hour window. Enforced once in the reservations service, applied
 * at all three entry points (direct book, hold, confirm) and inherited by the
 * AI agent, which books through the same service.
 */
describe('One reservation per café per 10-hour window (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let redis: Redis;

  // fixture.slotTime is 2026-08-01T09:00:00Z.
  const at = (hours: number) => new Date(new Date('2026-08-01T00:00:00.000Z').getTime() + hours * 3600_000);

  beforeAll(async () => {
    app = await createTestApp();
    redis = app.get(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await truncateAll(app);
    fixture = await seedFixture(app);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a second booking at the same café within 10h, naming the existing slot time', async () => {
    const token = await signup(app, 'alice@example.com');
    // fixture slot is 09:00; the second is at 14:00 (5h later), on a different table.
    const laterSlot = await addSlot(app, fixture.cafeId, at(14));

    await book(app, token, fixture.tableId, fixture.slotId).expect(201);

    const res = await book(app, token, fixture.otherTableId, laterSlot).expect(409);
    expect(res.body.message).toContain('2026-08-01T09:00:00.000Z');
  });

  it('allows a second booking at the same café 10h or more apart', async () => {
    const token = await signup(app, 'alice@example.com');
    const laterSlot = await addSlot(app, fixture.cafeId, at(19)); // exactly 10h after 09:00

    await book(app, token, fixture.tableId, fixture.slotId).expect(201);
    await book(app, token, fixture.otherTableId, laterSlot).expect(201);
  });

  it('allows same-evening bookings at two different cafés', async () => {
    const token = await signup(app, 'alice@example.com');
    const other = await addCafe(app, at(9)); // same 09:00 slot, different café

    await book(app, token, fixture.tableId, fixture.slotId).expect(201);
    await book(app, token, other.tableId, other.slotId).expect(201);
  });

  it('frees the user to re-book the café after cancelling the conflicting reservation', async () => {
    const token = await signup(app, 'alice@example.com');
    const laterSlot = await addSlot(app, fixture.cafeId, at(14));

    const first = await book(app, token, fixture.tableId, fixture.slotId).expect(201);
    await book(app, token, fixture.otherTableId, laterSlot).expect(409);

    await request(app.getHttpServer())
      .delete(`/reservations/${first.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await book(app, token, fixture.otherTableId, laterSlot).expect(201);
  });

  it('rejects the conflict at hold time, before any hold is taken', async () => {
    const token = await signup(app, 'alice@example.com');
    const laterSlot = await addSlot(app, fixture.cafeId, at(14));

    await book(app, token, fixture.tableId, fixture.slotId).expect(201);

    const res = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.otherTableId, slotId: laterSlot })
      .expect(409);
    expect(res.body.message).toContain('2026-08-01T09:00:00.000Z');

    // No hold should have been taken for the rejected slot — someone else can still hold it.
    const bob = await signup(app, 'bob@example.com');
    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${bob}`)
      .send({ tableId: fixture.otherTableId, slotId: laterSlot })
      .expect(201);
  });

  it('enforces the rule authoritatively at confirm, even when the hold was taken before the conflict existed', async () => {
    const token = await signup(app, 'alice@example.com');
    const laterSlot = await addSlot(app, fixture.cafeId, at(14));

    // Hold the 14:00 slot first — no conflict exists yet, so the hold succeeds.
    const hold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.otherTableId, slotId: laterSlot })
      .expect(201);

    // Now book the 09:00 slot directly — a hold is not a booked reservation, so this passes.
    await book(app, token, fixture.tableId, fixture.slotId).expect(201);

    // Confirming the earlier hold must now be rejected: a booked reservation
    // at 09:00 is within 10h of 14:00.
    const res = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.otherTableId, slotId: laterSlot, holdId: hold.body.holdId })
      .expect(409);
    expect(res.body.message).toContain('2026-08-01T09:00:00.000Z');
  });

  it('does not let the window rule turn a legitimate confirm-retry into a 409 (the booking must not count against itself)', async () => {
    const token = await signup(app, 'alice@example.com');

    const hold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId, holdId: hold.body.holdId })
      .expect(201);

    // Retrying the same (now consumed) hold must fail as 410 Gone — the single-
    // use hold semantics — not as a 409 window conflict against the reservation
    // this very confirm just wrote.
    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId, holdId: hold.body.holdId })
      .expect(410);
  });

  it('binds the AI booking agent to the same rule (hold via the agent is rejected)', async () => {
    const token = await signup(app, 'alice@example.com');
    // Pre-book the 09:00 slot on table 1.
    await book(app, token, fixture.tableId, fixture.slotId).expect(201);

    const worker = app.get(AgentWorkerService);
    const llm = app.get(AgentLlmClient);
    llm.clearScript();
    const script: ScriptedTurn[] = [
      { role: 'model', functionCall: { name: 'search_cafes', args: {} } },
      { role: 'model', functionCall: { name: 'check_availability', args: { cafeId: fixture.cafeId, date: '2026-08-01' } } },
      // Agent tries to hold the other table at the same café/slot — must be refused by the window rule.
      { role: 'model', functionCall: { name: 'hold_table', args: { tableId: fixture.otherTableId, slotId: fixture.slotId } } },
    ];
    llm.script(script);

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book me another table at that café' })
      .expect(201);

    await worker.processOnce();

    const wf = await app.get(DataSource).getRepository(AgentWorkflow).findOneOrFail({ where: { id: submit.body.id } });
    expect(wf.status).toBe(AgentWorkflowStatus.FAILED);
    expect(wf.failureReason).toContain('10-hour');
  });
});
