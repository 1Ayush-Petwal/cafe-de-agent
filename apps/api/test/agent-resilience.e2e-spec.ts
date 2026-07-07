import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AgentWorkerService, MAX_HOLDS_PER_WORKFLOW } from '../src/agent/agent-worker.service';
import { AgentLlmClient, ScriptedTurn } from '../src/agent/llm/agent-llm.client';
import { LlmTurn } from '../src/agent/llm/agent-llm.types';
import { HoldsService } from '../src/holds/holds.service';
import { AgentWorkflow } from '../src/entities/agent-workflow.entity';
import { Payment } from '../src/entities/payment.entity';
import { PaymentsService } from '../src/payments/payments.service';
import { Reservation } from '../src/entities/reservation.entity';
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

function findFunctionResponse(history: LlmTurn[], name: string): Record<string, unknown> {
  const turn = [...history].reverse().find((t) => t.functionResponse?.name === name);
  if (!turn?.functionResponse) {
    throw new Error(`No functionResponse for ${name} in history yet`);
  }
  return turn.functionResponse.response;
}

/**
 * Issue #10 (Roadmap M5, second half): the agent under failure. Builds on
 * issue #9's happy-path suite (agent.e2e-spec.ts) with the saga's failure
 * modes — pay-step compensation, crash-resume idempotency, ambiguous-request
 * clarification, and per-session guardrails. The LLM is the scripted fake
 * throughout, same as #9.
 */
describe('Agent under failure (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let worker: AgentWorkerService;
  let llm: AgentLlmClient;
  let payments: PaymentsService;
  let redis: Redis;
  const date = '2026-08-01';

  beforeAll(async () => {
    app = await createTestApp();
    worker = app.get(AgentWorkerService);
    llm = app.get(AgentLlmClient);
    payments = app.get(PaymentsService);
    redis = app.get(REDIS_CLIENT);
  });

  beforeEach(async () => {
    llm.clearScript();
    payments.setForceFailure(false);
    await truncateAll(app);
    fixture = await seedFixture(app);
    await redis.flushdb();
  });

  afterAll(async () => {
    payments.setForceFailure(false);
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

  it('compensates a pay-step failure: hold is released, workflow ends FAILED, nothing is booked', async () => {
    const token = await signup(app, 'alice@example.com');
    scriptFullBooking();

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);
    const workflowId = submit.body.id;

    await worker.processOnce();
    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    payments.setForceFailure(true);
    await worker.processOnce();

    const failed = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.reservationId).toBeNull();
    expect(failed.body.failureReason).toMatch(/payment/i);

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    expect(await paymentRepo.count()).toBe(0);

    // The hold was consumed (and thus released) before the charge ran — the
    // slot is free again, with no separate compensation step needed.
    payments.setForceFailure(false);
    const bob = await signup(app, 'bob@example.com');
    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${bob}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });

  it('resumes after a crash mid-hold without duplicating the hold (idempotent retry)', async () => {
    const token = await signup(app, 'alice@example.com');
    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);
    const workflowId = submit.body.id;

    // Simulate a worker crash right after a real hold_table call succeeded,
    // but before the workflow row's history/status was ever persisted: the
    // Redis side effect survives; the DB row is untouched (still fresh
    // PENDING). A naive retry of hold_table would hit a plain `SET NX`
    // conflict against this pre-existing hold and fail the whole workflow.
    const row = await app.get(DataSource).getRepository(AgentWorkflow).findOneByOrFail({ id: workflowId });
    const existingHold = await app.get(HoldsService).create(row.userId, fixture.tableId, fixture.slotId, 90);

    scriptFullBooking();
    await worker.processOnce();

    const parked = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(parked.body.status).toBe('awaiting_approval');
    // hold_table reused alice's own pre-existing hold rather than conflicting.
    expect(parked.body.pendingAction.args.holdId).toBe(existingHold!.holdId);

    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await worker.processOnce();

    const done = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.reservationId).toBeTruthy();

    const reservationRepo = app.get(DataSource).getRepository(Reservation);
    expect(await reservationRepo.count()).toBe(1);
  });

  it('resumes after a crash mid-confirm without double-charging (idempotent retry)', async () => {
    const token = await signup(app, 'alice@example.com');
    scriptFullBooking();

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);
    const workflowId = submit.body.id;

    await worker.processOnce();
    const parked = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const pendingArgs = parked.body.pendingAction.args;

    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Simulate the worker having already executed the real confirm_hold call
    // against the app's own API (charge + reservation) in a previous tick
    // that crashed before the workflow row was saved — the row is still
    // PENDING with pendingAction intact, exactly as approve() left it.
    const directConfirm = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `agent:${workflowId}`)
      .send(pendingArgs)
      .expect(201);

    await worker.processOnce();

    const done = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.reservationId).toBe(directConfirm.body.id);

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    const reservationRepo = app.get(DataSource).getRepository(Reservation);
    expect(await paymentRepo.count()).toBe(1);
    expect(await reservationRepo.count()).toBe(1);
  });

  it('asks a clarifying question on an ambiguous request, parks durably, and resumes on answer', async () => {
    const token = await signup(app, 'alice@example.com');
    const script: ScriptedTurn[] = [
      { role: 'model', functionCall: { name: 'ask_user', args: { question: 'What date and time would you like?' } } },
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

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book me a table' })
      .expect(201);
    const workflowId = submit.body.id;

    await worker.processOnce();

    const parked = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(parked.body.status).toBe('awaiting_input');
    expect(parked.body.pendingAction).toMatchObject({ name: 'ask_user' });

    // Rejecting an answer when not awaiting input is covered by a separately
    // submitted (fresh, pending) workflow below.

    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/answer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answer: 'Tonight at 8pm for 2' })
      .expect(201);

    await worker.processOnce();
    const parkedApproval = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(parkedApproval.body.status).toBe('awaiting_approval');
    expect(
      parkedApproval.body.history.some(
        (t: { functionResponse?: { name: string; response: { answer?: string } } }) =>
          t.functionResponse?.name === 'ask_user' && t.functionResponse.response.answer === 'Tonight at 8pm for 2',
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await worker.processOnce();

    const done = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.reservationId).toBeTruthy();
  });

  it('rejects answering a workflow that is not awaiting input, and a customer cannot answer another\'s workflow', async () => {
    const alice = await signup(app, 'alice@example.com');
    const bob = await signup(app, 'bob@example.com');

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${alice}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/agent/workflows/${submit.body.id}/answer`)
      .set('Authorization', `Bearer ${alice}`)
      .send({ answer: 'irrelevant' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/agent/workflows/${submit.body.id}/answer`)
      .set('Authorization', `Bearer ${bob}`)
      .send({ answer: 'irrelevant' })
      .expect(403);
  });

  it('cannot exceed its per-session hold budget — a runaway loop fails cleanly instead of spamming holds', async () => {
    const token = await signup(app, 'alice@example.com');
    const script: ScriptedTurn[] = [];
    for (let i = 0; i <= MAX_HOLDS_PER_WORKFLOW; i++) {
      script.push({
        role: 'model',
        functionCall: { name: 'hold_table', args: { tableId: fixture.tableId, slotId: fixture.slotId } },
      });
    }
    llm.script(script);

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);

    await worker.processOnce();

    const result = await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(result.body.status).toBe('failed');
    expect(result.body.failureReason).toMatch(/hold budget/i);
    expect(result.body.holdCount).toBe(MAX_HOLDS_PER_WORKFLOW);
  });

  it('cannot exceed its per-session cost budget — a second distinct charge in the same workflow is rejected', async () => {
    const token = await signup(app, 'alice@example.com');
    // Second booking is ≥10h from the first (20:00 vs the fixture's 09:00) so
    // the issue-#17 window rule allows both — this test is about the cost
    // budget, not the window: the second (distinct) charge must be stopped by
    // the idempotency guard, not by the window rule firing first.
    const slotRepo = app.get(DataSource).getRepository(Slot);
    const farSlot = await slotRepo.save(
      slotRepo.create({ cafeId: fixture.cafeId, slotTime: new Date('2026-08-01T20:00:00.000Z') }),
    );
    // Same deterministic idempotency key (`agent:{workflowId}`) is used for
    // every confirm_hold call within one workflow (issue #9) — a second,
    // materially different confirm attempt reuses that key but hashes to a
    // different request, so it's rejected outright rather than silently
    // re-charging. This is what actually caps a workflow to one real spend.
    const script: ScriptedTurn[] = [
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
      { role: 'model', functionCall: { name: 'hold_table', args: { tableId: fixture.otherTableId, slotId: farSlot.id } } },
      (history) => {
        const holds = history.filter((t) => t.functionResponse?.name === 'hold_table');
        const secondHold = holds[holds.length - 1].functionResponse!.response;
        return {
          role: 'model',
          functionCall: {
            name: 'confirm_hold',
            args: { tableId: fixture.otherTableId, slotId: farSlot.id, holdId: secondHold.holdId },
          },
        };
      },
    ];
    llm.script(script);

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);
    const workflowId = submit.body.id;

    await worker.processOnce();
    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await worker.processOnce();

    // First confirm succeeded and parked again for the second (distinct) one.
    const secondPark = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(secondPark.body.status).toBe('awaiting_approval');
    const firstReservationId = secondPark.body.reservationId;
    expect(firstReservationId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/agent/workflows/${workflowId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await worker.processOnce();

    const result = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(result.body.status).toBe('failed');
    // The first booking stands; the second attempt never charged.
    expect(result.body.reservationId).toBe(firstReservationId);

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    const reservationRepo = app.get(DataSource).getRepository(Reservation);
    expect(await paymentRepo.count()).toBe(1);
    expect(await reservationRepo.count()).toBe(1);
  });

  it('rate-limits agent workflow creation per user', async () => {
    const previousCapacity = process.env.RATE_LIMIT_USER_CAPACITY;
    const previousRefill = process.env.RATE_LIMIT_USER_REFILL_PER_SEC;
    process.env.RATE_LIMIT_USER_CAPACITY = '2';
    process.env.RATE_LIMIT_USER_REFILL_PER_SEC = '0.001';
    const limitedApp = await createTestApp();
    try {
      const limitedRedis = limitedApp.get(REDIS_CLIENT);
      await truncateAll(limitedApp);
      await seedFixture(limitedApp);
      await limitedRedis.flushdb();
      const token = await signup(limitedApp, 'alice@example.com');

      for (let i = 0; i < 2; i++) {
        await request(limitedApp.getHttpServer())
          .post('/agent/workflows')
          .set('Authorization', `Bearer ${token}`)
          .send({ message: 'Book a table for 2 tonight' })
          .expect(201);
      }
      await request(limitedApp.getHttpServer())
        .post('/agent/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'Book a table for 2 tonight' })
        .expect(429);
    } finally {
      await limitedApp.close();
      process.env.RATE_LIMIT_USER_CAPACITY = previousCapacity;
      process.env.RATE_LIMIT_USER_REFILL_PER_SEC = previousRefill;
    }
  });
});
