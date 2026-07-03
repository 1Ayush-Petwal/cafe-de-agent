import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Payment } from '../src/entities/payment.entity';
import { Reservation } from '../src/entities/reservation.entity';
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

  it('a retried confirm with the same key returns the stored result without re-charging or re-booking', async () => {
    const token = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);
    const key = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    // If the retry actually re-executed, it would try to consume an
    // already-consumed hold (410) and, if it somehow got past that, hit a
    // gateway now toggled to fail (402) — getting the *original* success
    // back proves the second request never touched hold-consume or charge.
    payments.setForceFailure(true);

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
  });

  it('replays a stored failure too: a retried confirm after a payment failure stays failed, no phantom booking', async () => {
    const token = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);
    const key = randomUUID();

    payments.setForceFailure(true);
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
    const token = await signup(app, 'alice@example.com');
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
    const token = await signup(app, 'alice@example.com');
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
    const token = await signup(app, 'alice@example.com');
    const hold = await createHold(app, token, fixture.tableId, fixture.slotId);

    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ holdId: hold.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
  });
});
