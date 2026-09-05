import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { Payment } from '../src/entities/payment.entity';
import { Reservation } from '../src/entities/reservation.entity';
import { User } from '../src/entities/user.entity';
import { WALLET_SIGNUP_BALANCE } from '../src/entities/wallet.constants';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, Fixture, FIXTURE_SLOT_PRICE_MINOR, seedFixture, truncateAll } from './utils/test-app';

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
 * payment gateway (issue #5) — every confirmed booking charges the slot's
 * own price, charged atomically alongside the reservation write, refunded
 * on cancel. Issue #3 (PRD area A): balances and charges are integer paise.
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

  it('grants the signup starting balance on signup', async () => {
    const { walletBalance: balance } = await signup(app, 'alice@example.com');
    expect(balance).toBe(WALLET_SIGNUP_BALANCE);
  });

  it('charges the direct book path identically to hold→confirm: the slot\'s own price, with a payment recorded', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');

    const bookRes = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    expect(await walletBalance(app, userId)).toBe(WALLET_SIGNUP_BALANCE - FIXTURE_SLOT_PRICE_MINOR);
    const paymentRepo = app.get(DataSource).getRepository(Payment);
    const payment = await paymentRepo.findOne({ where: { reservationId: bookRes.body.id } });
    expect(payment).toMatchObject({ amount: FIXTURE_SLOT_PRICE_MINOR });
  });

  it('rejects a direct booking with 402 when the balance is too low, writing nothing', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    await app.get(DataSource).getRepository(User).update({ id: userId }, { walletBalance: 1000 });

    const res = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(402);
    expect(res.body.message).toMatch(/₹10\b/);

    expect(await app.get(DataSource).getRepository(Reservation).count()).toBe(0);
    expect(await app.get(DataSource).getRepository(Payment).count()).toBe(0);
    expect(await walletBalance(app, userId)).toBe(1000);
  });

  it('refunds the slot\'s price when a confirmed booking is cancelled', async () => {
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
    expect(await walletBalance(app, userId)).toBe(WALLET_SIGNUP_BALANCE - FIXTURE_SLOT_PRICE_MINOR);

    await request(app.getHttpServer())
      .delete(`/reservations/${confirm.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await walletBalance(app, userId)).toBe(WALLET_SIGNUP_BALANCE);

    // Cancelling again is a no-op, not a second refund.
    await request(app.getHttpServer())
      .delete(`/reservations/${confirm.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(await walletBalance(app, userId)).toBe(WALLET_SIGNUP_BALANCE);
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

    expect(await walletBalance(app, alice.userId)).toBe(WALLET_SIGNUP_BALANCE);
  });
});
