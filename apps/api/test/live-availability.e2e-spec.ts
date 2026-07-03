import http from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
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

/**
 * Nest flushes the SSE response headers *before* the controller's Observable
 * teardown logic (which issues the Redis `SUBSCRIBE`) actually completes —
 * so a client that only waits for `connectSse` to resolve can still race a
 * publish that happens immediately after. Poll `PUBSUB NUMSUB` (real Redis
 * state, not a timer) so the test only proceeds once the subscription is
 * actually live, per the house rule against relying on real timing.
 */
async function waitForSubscriber(redis: Redis, channel: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [, count] = (await redis.pubsub('NUMSUB', channel)) as [string, number];
    if (count > 0) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for a subscriber on ${channel}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A raw `EventSource`-equivalent: connects over plain HTTP and parses the
 * `text/event-stream` framing so tests don't depend on a browser API. */
interface SseClient {
  waitForEvent(predicate: (data: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

function connectSse(port: number, path: string): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connect failed with status ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      let buffer = '';
      const received: Record<string, unknown>[] = [];
      let pendingWaiter: { predicate: (d: Record<string, unknown>) => boolean; resolve: (d: Record<string, unknown>) => void } | null = null;

      res.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLines = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim());
          if (dataLines.length === 0) continue;
          const parsed = JSON.parse(dataLines.join('\n'));
          received.push(parsed);
          if (pendingWaiter && pendingWaiter.predicate(parsed)) {
            const { resolve: resolveWaiter } = pendingWaiter;
            pendingWaiter = null;
            resolveWaiter(parsed);
          }
        }
      });

      resolve({
        waitForEvent(predicate, timeoutMs = 5000) {
          const already = received.find(predicate);
          if (already) return Promise.resolve(already);
          return new Promise((resolveWait, rejectWait) => {
            const timer = setTimeout(() => {
              pendingWaiter = null;
              rejectWait(new Error('Timed out waiting for SSE event'));
            }, timeoutMs);
            pendingWaiter = {
              predicate,
              resolve: (d) => {
                clearTimeout(timer);
                resolveWait(d);
              },
            };
          });
        },
        close() {
          req.destroy();
        },
      });
    });
    req.on('error', reject);
  });
}

/**
 * M4 (issue #7): the availability grid updates live over SSE, backed by a
 * Redis pub/sub channel per café so the fan-out works across API instances,
 * not just within one process's event loop.
 */
describe('Live availability (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let redis: Redis;

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

  it('pushes a hold to a connected SSE client on the same instance', async () => {
    const token = await signup(app, 'alice@example.com');
    const client = await connectSse(portOf(app), `/cafes/${fixture.cafeId}/availability/stream`);

    try {
      await waitForSubscriber(redis, `cafe:${fixture.cafeId}`);
      await request(app.getHttpServer())
        .post('/reservations/hold')
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotId })
        .expect(201);

      const event = await client.waitForEvent((e) => e.type === 'held');
      expect(event).toMatchObject({ type: 'held', tableId: fixture.tableId, slotId: fixture.slotId });
    } finally {
      client.close();
    }
  });

  it('fans a change committed on one API instance out to a client connected to another (Redis backplane)', async () => {
    const instanceA = await createTestApp();
    const instanceB = await createTestApp();

    try {
      const token = await signup(instanceA, 'alice@example.com');
      const client = await connectSse(portOf(instanceB), `/cafes/${fixture.cafeId}/availability/stream`);

      try {
        await waitForSubscriber(redis, `cafe:${fixture.cafeId}`);
        await request(instanceA.getHttpServer())
          .post('/reservations/hold')
          .set('Authorization', `Bearer ${token}`)
          .send({ tableId: fixture.tableId, slotId: fixture.slotId })
          .expect(201);

        const event = await client.waitForEvent((e) => e.type === 'held');
        expect(event).toMatchObject({ type: 'held', tableId: fixture.tableId, slotId: fixture.slotId });
      } finally {
        client.close();
      }
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('pushes confirmed and cancelled events for the same reservation lifecycle', async () => {
    const token = await signup(app, 'alice@example.com');
    const client = await connectSse(portOf(app), `/cafes/${fixture.cafeId}/availability/stream`);

    try {
      await waitForSubscriber(redis, `cafe:${fixture.cafeId}`);
      const holdRes = await request(app.getHttpServer())
        .post('/reservations/hold')
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotId })
        .expect(201);

      const confirmRes = await request(app.getHttpServer())
        .post('/reservations/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ holdId: holdRes.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
        .expect(201);

      await client.waitForEvent((e) => e.type === 'confirmed');

      await request(app.getHttpServer())
        .delete(`/reservations/${confirmRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const cancelled = await client.waitForEvent((e) => e.type === 'cancelled');
      expect(cancelled).toMatchObject({ type: 'cancelled', tableId: fixture.tableId, slotId: fixture.slotId });
    } finally {
      client.close();
    }
  });
});
