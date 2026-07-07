import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Payment } from '../src/entities/payment.entity';
import { Reservation } from '../src/entities/reservation.entity';
import { User } from '../src/entities/user.entity';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function drainWallet(app: INestApplication, userId: string): Promise<void> {
  await app.get(DataSource).getRepository(User).update({ id: userId }, { walletBalance: 0 });
}

async function walletBalance(app: INestApplication, userId: string): Promise<number> {
  const user = await app.get(DataSource).getRepository(User).findOneByOrFail({ id: userId });
  return user.walletBalance;
}

async function createHold(
  app: INestApplication,
  token: string,
  tableId: string,
  slotId: string,
): Promise<{ holdId: string }> {
  const res = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, slotId })
    .expect(201);
  return res.body;
}

/**
 * Issue #11: Idempotency-Key on POST /reservations/confirm. See
 * docs/idempotency-keys.md for the keying/retention contract this proves.
 */
describe('Idempotency-Key on confirm (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    fixture = await seedFixture(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a retried confirm with the same key returns the stored result without re-charging or re-booking', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);
    const key = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    // If the retry actually re-executed, it would try to consume an
    // already-consumed hold (410) and, if it somehow got past that, hit an
    // empty wallet (402) — getting the *original* success back proves the
    // second request never touched hold-consume or charge.
    await drainWallet(app, userId);

    const second = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    expect(second.body).toEqual(first.body);

    const reservationRepo = app.get(DataSource).getRepository(Reservation);
    expect(await reservationRepo.count()).toBe(1);
    const paymentRepo = app.get(DataSource).getRepository(Payment);
    expect(await paymentRepo.count()).toBe(1);

    // Balance is still exactly what the drain above set it to — proving the
    // replay never ran chargeWallet a second time (it would have thrown
    // InsufficientBalanceError against this drained wallet and 402'd instead
    // of returning the first response's 201).
    expect(await walletBalance(app, userId)).toBe(0);
  });

  it('replays a stored failure too: a retried confirm after a payment failure stays failed, no phantom booking', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);
    const key = randomUUID();

    await drainWallet(app, userId);
    const first = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(402);

    const second = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(402);

    expect(second.body.message).toEqual(first.body.message);

    const reservationRepo = app.get(DataSource).getRepository(Reservation);
    expect(await reservationRepo.count()).toBe(0);
  });

  it('rejects reusing the same key for a materially different request', async () => {
    const { token } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);
    const otherHold = await createHold(app, token, fixture.otherTableId, fixture.slotId);
    const key = randomUUID();

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: otherHold.holdId, tableId: fixture.otherTableId, slotId: fixture.slotId })
      .expect(409);
  });

  it('double-clicking confirm (same key, concurrent requests) yields exactly one reservation and one charge', async () => {
    const { token } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);
    const key = randomUUID();

    const send = () =>
      request(app.getHttpServer())
        .post('/reservations/confirm')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId });

    const [a, b] = await Promise.all([send(), send()]);

    for (const res of [a, b]) {
      expect([201, 409]).toContain(res.status);
    }
    const successes = [a, b].filter((res) => res.status === 201);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(new Set(successes.map((res) => res.body.id)).size).toBe(1);

    const reservationRepo = app.get(DataSource).getRepository(Reservation);
    expect(await reservationRepo.count()).toBe(1);
    const paymentRepo = app.get(DataSource).getRepository(Payment);
    expect(await paymentRepo.count()).toBe(1);
  });

  it('confirm with no Idempotency-Key header behaves exactly as before (no regression)', async () => {
    const { token } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });
});
