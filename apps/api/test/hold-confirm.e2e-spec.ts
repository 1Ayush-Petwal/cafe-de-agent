import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
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
 * M2 (issue #4): checkout takes a Redis TTL hold rather than a long DB
 * transaction. These tests exercise the acceptance criteria directly: a
 * held slot is unavailable to others, confirming within the TTL produces a
 * reservation and consumes the hold, an abandoned hold auto-releases, and
 * the last-second confirm-vs-expiry race is closed by an atomic
 * check-and-delete rather than a naive DEL.
 */
describe('Hold -> confirm (e2e)', () => {
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

  it('creates a TTL hold with a future expiry', async () => {
    const token = await signup(app, 'alice@example.com');

    const res = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    expect(res.body).toMatchObject({ tableId: fixture.tableId, slotId: fixture.slotId });
    expect(res.body.holdId).toEqual(expect.any(String));
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('makes a held slot unavailable to other customers, including for a competing hold', async () => {
    const alice = await signup(app, 'alice@example.com');
    const bob = await signup(app, 'bob@example.com');

    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${alice}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    const availability = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .set('Authorization', `Bearer ${bob}`)
      .expect(200);
    const table = availability.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
    expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: false });

    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${bob}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(409);
  });

  it('confirms within the TTL into a booked reservation and consumes the hold', async () => {
    const token = await signup(app, 'alice@example.com');
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
    expect(confirmRes.body).toMatchObject({
      tableId: fixture.tableId,
      slotId: fixture.slotId,
      status: 'booked',
    });

    // The hold is single-use: replaying the same holdId fails.
    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: holdRes.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(410);
  });

  it('rejects confirm from a user who does not own the hold, without disturbing the real owner', async () => {
    const alice = await signup(app, 'alice@example.com');
    const bob = await signup(app, 'bob@example.com');

    const holdRes = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${alice}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${bob}`)
      .send({ holdId: holdRes.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(410);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${alice}`)
      .send({ holdId: holdRes.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });

  it('auto-releases an abandoned hold so the slot frees up with no manual cleanup', async () => {
    const alice = await signup(app, 'alice@example.com');
    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${alice}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 2300));

    const availability = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);
    const table = availability.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
    expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: true });

    const bob = await signup(app, 'bob@example.com');
    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${bob}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });

  it("closes the last-second race: a stale confirm fails cleanly instead of stealing the new holder's slot", async () => {
    const alice = await signup(app, 'alice@example.com');
    const bob = await signup(app, 'bob@example.com');

    const aliceHold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${alice}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    // Simulate Alice's hold expiring in Redis exactly as her confirm is in
    // flight, and Bob winning the re-hold in that gap.
    await redis.del(`hold:${fixture.tableId}:${fixture.slotId}`);
    const bobHold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${bob}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    // Alice's confirm, using her now-stale holdId, must fail cleanly...
    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${alice}`)
      .send({ holdId: aliceHold.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(410);

    // ...and must not have deleted Bob's legitimately re-acquired hold — a
    // naive check-then-DEL would have let Alice's stale confirm clobber it.
    const bobConfirm = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${bob}`)
      .send({ holdId: bobHold.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
    expect(bobConfirm.body).toMatchObject({
      tableId: fixture.tableId,
      slotId: fixture.slotId,
      status: 'booked',
    });
  });
});
