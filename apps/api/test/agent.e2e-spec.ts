import http from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AgentWorkerService } from '../src/agent/agent-worker.service';
import { AgentLlmClient, ScriptedTurn } from '../src/agent/llm/agent-llm.client';
import { LlmTurn } from '../src/agent/llm/agent-llm.types';
import { Reservation } from '../src/entities/reservation.entity';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import Redis from 'ioredis';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken;
}

function portOf(app: INestApplication): number {
  return (app.getHttpServer().address() as AddressInfo).port;
}

/** Minimal `EventSource`-equivalent over plain HTTP — same shape as the one in live-availability.e2e-spec.ts. */
function connectSse(port: number, path: string): Promise<{ waitForData: (timeoutMs?: number) => Promise<void>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connect failed with status ${res.statusCode}`));
        return;
      }
      let gotData = false;
      let waiter: (() => void) | null = null;
      res.on('data', () => {
        gotData = true;
        waiter?.();
      });
      resolve({
        waitForData(timeoutMs = 5000) {
          if (gotData) return Promise.resolve();
          return new Promise((resolveWait, rejectWait) => {
            const timer = setTimeout(() => rejectWait(new Error('Timed out waiting for SSE data')), timeoutMs);
            waiter = () => {
              clearTimeout(timer);
              resolveWait();
            };
          });
        },
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

function findFunctionResponse(history: LlmTurn[], name: string): Record<string, unknown> {
  const turn = [...history].reverse().find((t) => t.functionResponse?.name === name);
  if (!turn?.functionResponse) {
    throw new Error(`No functionResponse for ${name} in history yet`);
  }
  return turn.functionResponse.response;
}

/**
 * Issue #9 (Roadmap M5, happy path): NL request -> durable workflow run by
 * the worker -> AWAITING_APPROVAL before the spend step -> approval resumes
 * to a confirmed booking. The LLM is the scripted fake at the client
 * boundary throughout — this suite makes no real Gemini calls.
 */
describe('Agent happy path (e2e)', () => {
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

  it('runs search -> availability -> hold -> pauses for approval -> confirms into a real reservation', async () => {
    const token = await signup(app, 'alice@example.com');
    scriptFullBooking();

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);
    const workflowId = submit.body.id;
    expect(submit.body.status).toBe('pending');

    // The loop runs on the worker, not inside the HTTP request above.
    await worker.processOnce();

    const parked = await request(app.getHttpServer())
      .get(`/agent/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(parked.body.status).toBe('awaiting_approval');
    expect(parked.body.pendingAction).toMatchObject({ name: 'confirm_hold' });
    expect(parked.body.reservationId).toBeNull();

    // Approving flips it back to PENDING; the worker (not the HTTP request) executes the spend step.
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
    const reservation = await reservationRepo.findOneOrFail({ where: { id: done.body.reservationId } });
    expect(reservation.tableId).toBe(fixture.tableId);
    expect(reservation.slotId).toBe(fixture.slotId);
  });

  it('streams progress over SSE as the worker advances the workflow', async () => {
    const token = await signup(app, 'alice@example.com');
    scriptFullBooking();

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);

    const client = await connectSse(portOf(app), `/agent/workflows/${submit.body.id}/stream?token=${token}`);
    try {
      const [, dataEvent] = await Promise.all([worker.processOnce(), client.waitForData()]);
      void dataEvent;
    } finally {
      client.close();
    }
  });

  it('rejects approving a workflow that is not awaiting approval', async () => {
    const token = await signup(app, 'alice@example.com');
    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/agent/workflows/${submit.body.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('a customer cannot view or approve another customer\'s workflow', async () => {
    const aliceToken = await signup(app, 'alice@example.com');
    const bobToken = await signup(app, 'bob@example.com');

    const submit = await request(app.getHttpServer())
      .post('/agent/workflows')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ message: 'Book a table for 2 tonight' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/agent/workflows/${submit.body.id}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/agent/workflows/${submit.body.id}/approve`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(403);
  });
});
