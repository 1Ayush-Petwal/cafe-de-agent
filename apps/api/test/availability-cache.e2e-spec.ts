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

/**
 * M6 (issue #13): cache-aside for search/availability reads, invalidated by
 * the same booking-state events that already feed the live grid (issue #7).
 */
describe('Availability cache-aside (e2e)', () => {
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

  const dateOnly = () => fixture.slotTime.toISOString().slice(0, 10);
  const cacheKey = () => `availability:${fixture.cafeId}:${dateOnly()}`;

  it('serves availability cache-aside from Redis with a TTL', async () => {
    expect(await redis.get(cacheKey())).toBeNull();

    await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);

    const cached = await redis.get(cacheKey());
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached as string)).toEqual(
      expect.arrayContaining([expect.objectContaining({ tableId: fixture.tableId })]),
    );
    const ttl = await redis.ttl(cacheKey());
    expect(ttl).toBeGreaterThan(0);
  });

  it('invalidates the cached entry when a booking-state event fires for that café', async () => {
    const token = await signup(app, 'alice@example.com');

    await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);
    expect(await redis.get(cacheKey())).not.toBeNull();

    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    expect(await redis.get(cacheKey())).toBeNull();

    const fresh = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);
    const table = fresh.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
    expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: false });
  });

  it('cannot double-book a slot via a deliberately stale cache entry — write path re-validates', async () => {
    const owner = await signup(app, 'owner@example.com');
    const attacker = await signup(app, 'attacker@example.com');

    // Genuinely book the slot through the real API first.
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${owner}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    // Plant a stale cache entry that lies and says the slot is still free —
    // simulating a read that was cached just before the booking landed.
    await redis.set(
      cacheKey(),
      JSON.stringify([
        {
          tableId: fixture.tableId,
          label: 'T1',
          capacity: 2,
          slots: [{ slotId: fixture.slotId, slotTime: fixture.slotTime, available: true }],
        },
      ]),
      'EX',
      60,
    );

    // The (misleading) cached read still says available.
    const cachedRead = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);
    expect(cachedRead.body[0].slots[0].available).toBe(true);

    // But the write path never consults the cache — it re-validates against
    // Postgres/Redis-holds directly, so the double booking is still rejected.
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${attacker}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(409);

    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${attacker}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(409);
  });
});
