import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Payment } from '../src/entities/payment.entity';
import { User } from '../src/entities/user.entity';
import { WALLET_SIGNUP_BALANCE } from '../src/entities/wallet.constants';
import { createTestApp, Fixture, FIXTURE_SLOT_PRICE_MINOR, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createHold(
  app: INestApplication,
  token: string,
  fixture: Fixture,
): Promise<{ holdId: string }> {
  const res = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: fixture.tableId, slotId: fixture.slotId })
    .expect(201);
  return res.body;
}

/**
 * Issue #21 (PRD area C): confirm charges the fake wallet before writing
 * the reservation — replacing the old coin-flip mock gateway (issue #5).
 * Issue #3 (PRD area A): the charge is the slot's own price in paise.
 */
describe('Confirm charges the wallet (e2e)', () => {
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

  it('charges the slot\'s own price and leaves a payment record alongside the booked reservation', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture);

    const confirmRes = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
    expect(confirmRes.body).toMatchObject({ status: 'booked' });

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    const payment = await paymentRepo.findOne({ where: { reservationId: confirmRes.body.id } });
    expect(payment).toMatchObject({ amount: FIXTURE_SLOT_PRICE_MINOR });

    const userRepo = app.get(DataSource).getRepository(User);
    const user = await userRepo.findOneByOrFail({ id: userId });
    expect(user.walletBalance).toBe(WALLET_SIGNUP_BALANCE - FIXTURE_SLOT_PRICE_MINOR);
  });

  it('fails cleanly with 402 when the balance is too low: no reservation, no payment, hold released', async () => {
    const { token, userId } = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture);

    // Drain the wallet below the slot's price to force insufficient balance.
    await app.get(DataSource).getRepository(User).update({ id: userId }, { walletBalance: 1000 });

    const res = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(402);
    expect(res.body.message).toMatch(/₹10\b/);

    const mine = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body).toHaveLength(0);

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    expect(await paymentRepo.count()).toBe(0);

    const userRepo = app.get(DataSource).getRepository(User);
    const user = await userRepo.findOneByOrFail({ id: userId });
    expect(user.walletBalance).toBe(1000);

    // The hold was already consumed before the charge ran, so the slot is
    // free again — no separate "release" step needed, and it's retryable.
    const bob = await signup(app, 'bob@example.com');
    const retryHold = await createHold(app, bob.token, fixture);
    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ holdId: retryHold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });
});
