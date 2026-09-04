import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { AgentWorkerService } from '../src/agent/agent-worker.service';
import { AgentLlmClient, ScriptedTurn } from '../src/agent/llm/agent-llm.client';
import { LlmTurn } from '../src/agent/llm/agent-llm.types';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, Fixture, FIXTURE_SLOT_PRICE_MINOR, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken as string;
}

/** The fixture café sits in 'Connaught Place' with a slot at 2026-08-01T09:00:00Z (see test-app.ts). */
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
      maxPerBookingMinor: FIXTURE_SLOT_PRICE_MINOR,
      maxTotalMinor: FIXTURE_SLOT_PRICE_MINOR * 3,
      maxBookings: 3,
      allowedLocalities: ['Connaught Place'],
      windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: '2026-10-01T00:00:00.000Z',
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

function findFunctionResponse(history: LlmTurn[], name: string): Record<string, unknown> {
  const turn = [...history].reverse().find((t) => t.functionResponse?.name === name);
  if (!turn?.functionResponse) {
    throw new Error(`No functionResponse for ${name} in history yet`);
  }
  return turn.functionResponse.response;
}

/**
 * Issue #7 (PRD area D): the first-party agent becomes the mandate-bound
 * buyer. Every scenario here starts a conversation with a mandate attached
 * (`AgentToolsService` is the real seam the worker calls through — no
 * internal service is invoked directly) and drives it via the worker's
 * `processOnce()`, exactly like agent.e2e-spec.ts's no-mandate happy path.
 */
describe('Agent books under a mandate (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let worker: AgentWorkerService;
  let llm: AgentLlmClient;
  let redis: Redis;
  const date = '2026-08-01';

  beforeAll(async () => {
    app = await createTestApp();
    worker = app.get(AgentWorkerService);
    llm = app.get(AgentLlmClient);
    redis = app.get(REDIS_CLIENT);
  });

  beforeEach(async () => {
    llm.clearScript();
    await truncateAll(app);
    fixture = await seedFixture(app);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  function scriptFullBooking(): void {
    const script: ScriptedTurn[] = [
      { role: 'model', functionCall: { name: 'search_cafes', args: {} } },
      { role: 'model', functionCall: { name: 'check_availability', args: { cafeId: fixture.cafeId, date } } },
      { role: 'model', functionCall: { name: 'hold_table', args: { tableId: fixture.tableId, slotId: fixture.slotId } } },
      (history) => {
        const hold = findFunctionResponse(history, 'hold_table');
        return {
          role: 'model',
          functionCall: {
            name: 'confirm_hold',
            args: { tableId: fixture.tableId, slotId: fixture.slotId, holdId: hold.holdId },
          },
        };
      },
      { role: 'model', text: 'Booked your table — see you tonight!' },
    ];
    llm.script(script);
  }

  it('starts a conversation with a mandate attached and stores it on the workflow', async () => {
    const token = await signup(app, 'alice@example.com');
    const mandateId = await grantMandate(app, token);

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight', mandateId })
      .expect(201);

    const workflow = await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(workflow.body.mandateId).toBe(mandateId);
  });

  it('rejects attaching a mandate that is not the caller\'s', async () => {
    const aliceToken = await signup(app, 'alice@example.com');
    const bobToken = await signup(app, 'bob@example.com');
    const mandateId = await grantMandate(app, aliceToken);

    await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ message: 'Book a table for 2 tonight', mandateId })
      .expect(403);
  });

  it('completes a spend inside the mandate without ever parking for approval', async () => {
    const token = await signup(app, 'alice@example.com');
    const mandateId = await grantMandate(app, token);
    scriptFullBooking();

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight', mandateId })
      .expect(201);

    await worker.processOnce();

    const done = await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.reservationId).toBeTruthy();
    // Never touched AWAITING_APPROVAL along the way.
    expect(JSON.stringify(done.body.history)).not.toContain('awaiting_approval');

    const status = await request(app.getHttpServer())
      .get(`/mandates/${mandateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.consumedMinor).toBe(FIXTURE_SLOT_PRICE_MINOR);
    expect(status.body.consumedBookings).toBe(1);
  });

  it('refuses a spend the mandate denies, surfacing verdict/reason/headroom in the conversation without failing the workflow', async () => {
    const token = await signup(app, 'alice@example.com');
    // Per-booking ceiling below the fixture slot's price -> the atomic gate denies at confirm.
    const mandateId = await grantMandate(app, token, {
      maxPerBookingMinor: FIXTURE_SLOT_PRICE_MINOR - 1,
      maxTotalMinor: FIXTURE_SLOT_PRICE_MINOR * 3,
    });

    const script: ScriptedTurn[] = [
      { role: 'model', functionCall: { name: 'search_cafes', args: {} } },
      { role: 'model', functionCall: { name: 'check_availability', args: { cafeId: fixture.cafeId, date } } },
      { role: 'model', functionCall: { name: 'hold_table', args: { tableId: fixture.tableId, slotId: fixture.slotId } } },
      (history) => {
        const hold = findFunctionResponse(history, 'hold_table');
        return {
          role: 'model',
          functionCall: {
            name: 'confirm_hold',
            args: { tableId: fixture.tableId, slotId: fixture.slotId, holdId: hold.holdId },
          },
        };
      },
      { role: 'model', text: 'That would exceed your mandate\'s per-booking limit, so I did not book it.' },
    ];
    llm.script(script);

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight', mandateId })
      .expect(201);

    await worker.processOnce();

    const done = await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.reservationId).toBeNull();

    const denial = findFunctionResponse(done.body.history, 'confirm_hold');
    expect(denial).toMatchObject({
      verdict: 'DENY',
      reason: 'per_booking_ceiling_exceeded',
      remainingMinor: FIXTURE_SLOT_PRICE_MINOR * 3,
      remainingBookings: 3,
    });

    // Nothing was consumed — the atomic gate denied before writing anything.
    const status = await request(app.getHttpServer())
      .get(`/mandates/${mandateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.consumedMinor).toBe(0);
    expect(status.body.consumedBookings).toBe(0);
  });

  it('lets the agent query its own remaining headroom as a tool call', async () => {
    const token = await signup(app, 'alice@example.com');
    const mandateId = await grantMandate(app, token);

    const script: ScriptedTurn[] = [
      { role: 'model', functionCall: { name: 'get_mandate_status', args: {} } },
      { role: 'model', text: 'You have plenty of headroom left on your mandate.' },
    ];
    llm.script(script);

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'How much of my mandate is left?', mandateId })
      .expect(201);

    await worker.processOnce();

    const done = await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.status).toBe('done');

    const status = findFunctionResponse(done.body.history, 'get_mandate_status');
    expect(status).toMatchObject({
      id: mandateId,
      maxTotalMinor: FIXTURE_SLOT_PRICE_MINOR * 3,
      remainingMinor: FIXTURE_SLOT_PRICE_MINOR * 3,
      remainingBookings: 3,
    });
  });

  it('a conversation with no mandate still parks for approval, exactly as before', async () => {
    const token = await signup(app, 'alice@example.com');
    scriptFullBooking();

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);

    await worker.processOnce();

    const parked = await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(parked.body.status).toBe('awaiting_approval');
    expect(parked.body.mandateId).toBeNull();
  });
});
