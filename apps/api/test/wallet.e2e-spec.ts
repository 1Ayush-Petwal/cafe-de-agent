import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { Payment } from '../src/entities/payment.entity';
import { Reservation } from '../src/entities/reservation.entity';
import { User } from '../src/entities/user.entity';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<{ token: string; userId: string; walletBalance: number }> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return { token: res.body.accessToken, userId: res.body.user.id, walletBalance: res.body.user.walletBalance };
}

async function walletBalance(app: INestApplication, userId: string): Promise<number> {
  const user = await app.get(DataSource).getRepository(User).findOneByOrFail({ id: userId });
  return user.walletBalance;
}

/**
 * Issue #21 (PRD area C): a fake in-app wallet replaces the coin-flip mock
 * payment gateway (issue #5) — every confirmed booking costs a flat ₹25,
 * charged atomically alongside the reservation write, refunded on cancel.
 */
describe('Wallet (e2e)', () => {
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

  it('grants a ₹500 starting balance on signup', async () => {
    const { walletBalance: balance } = await signup(app, 'alice@example.com');
    expect(balance).toBe(500);
  });

  it('charges the direct book path identically to hold→confirm: ₹25, with a payment recorded', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');

    const bookRes = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    expect(await walletBalance(app, userId)).toBe(475);
    const paymentRepo = app.get(DataSource).getRepository(Payment);
    const payment = await paymentRepo.findOne({ where: { reservationId: bookRes.body.id } });
    expect(payment).toMatchObject({ amount: 25 });
  });

  it('rejects a direct booking with 402 when the balance is too low, writing nothing', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    await app.get(DataSource).getRepository(User).update({ id: userId }, { walletBalance: 24 });

    const res = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(402);
    expect(res.body.message).toMatch(/₹24/);

    expect(await app.get(DataSource).getRepository(Reservation).count()).toBe(0);
    expect(await app.get(DataSource).getRepository(Payment).count()).toBe(0);
    expect(await walletBalance(app, userId)).toBe(24);
  });

  it('refunds ₹25 when a confirmed booking is cancelled', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    const hold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
    const confirm = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
    expect(await walletBalance(app, userId)).toBe(475);

    await request(app.getHttpServer())
      .delete(`/reservations/${confirm.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await walletBalance(app, userId)).toBe(500);

    // Cancelling again is a no-op, not a second refund.
    await request(app.getHttpServer())
      .delete(`/reservations/${confirm.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(await walletBalance(app, userId)).toBe(500);
  });

  it('leaves the balance untouched when a hold is lost to a race before confirm', async () => {
    const alice = await signup(app, 'alice@example.com');
    const bob = await signup(app, 'bob@example.com');

    const aliceHold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    // Simulate Alice's hold expiring in Redis exactly as her confirm is in
    // flight, and Bob winning the re-hold in that gap (same technique as
    // hold-confirm.e2e-spec.ts's last-second-race test).
    await redis.del(`hold:${fixture.tableId}:${fixture.slotId}`);
    await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ holdId: aliceHold.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(410);

    expect(await walletBalance(app, alice.userId)).toBe(500);
  });
});
