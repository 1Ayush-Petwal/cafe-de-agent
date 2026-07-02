import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Payment } from '../src/entities/payment.entity';
import { PaymentsService } from '../src/payments/payments.service';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken;
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
 * Issue #5: confirm charges a mock payment before writing the reservation.
 * The gateway's failure is a settable toggle (a product feature reused by
 * the M5 saga tests, not just a test convenience) rather than a random
 * chance of failure, so these tests drive it deterministically.
 */
describe('Confirm pays (mock) (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let payments: PaymentsService;

  beforeAll(async () => {
    app = await createTestApp();
    payments = app.get(PaymentsService);
  });

  beforeEach(async () => {
    payments.setForceFailure(false);
    await truncateAll(app);
    fixture = await seedFixture(app);
  });

  afterAll(async () => {
    payments.setForceFailure(false);
    await app.close();
  });

  it('charges successfully and leaves a payment record alongside the booked reservation', async () => {
    const token = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture);

    const confirmRes = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
    expect(confirmRes.body).toMatchObject({ status: 'booked' });

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    const payment = await paymentRepo.findOne({ where: { reservationId: confirmRes.body.id } });
    expect(payment).not.toBeNull();
  });

  it('fails cleanly when the gateway is toggled to fail: no reservation, no payment, hold released', async () => {
    const token = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture);

    payments.setForceFailure(true);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(402);

    const mine = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body).toHaveLength(0);

    const paymentRepo = app.get(DataSource).getRepository(Payment);
    expect(await paymentRepo.count()).toBe(0);

    // The hold was already consumed before the charge ran, so the slot is
    // free again — no separate "release" step needed, and it's retryable.
    payments.setForceFailure(false);
    const bob = await signup(app, 'bob@example.com');
    const retryHold = await createHold(app, bob, fixture);
    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${bob}`)
      .send({ holdId: retryHold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });
});
