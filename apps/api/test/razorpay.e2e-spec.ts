import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Payment } from '../src/entities/payment.entity';
import { Reservation } from '../src/entities/reservation.entity';
import { Slot } from '../src/entities/slot.entity';
import { RazorpayClient } from '../src/payments/razorpay.client';
import { capturedPayload, postWebhook, signPayload, WEBHOOK_SECRET } from './utils/razorpay-webhook';
import { createTestApp, Fixture, FIXTURE_SLOT_PRICE_MINOR, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function createHold(app: INestApplication, token: string, tableId: string, slotId: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, slotId })
    .expect(201);
  return res.body.holdId as string;
}

async function grantMandate(
  app: INestApplication,
  token: string,
  overrides: Partial<{ maxPerBookingMinor: number; maxTotalMinor: number; maxBookings: number }> = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/mandates')
    .set('Authorization', `Bearer ${token}`)
    .send({
      maxPerBookingMinor: FIXTURE_SLOT_PRICE_MINOR,
      maxTotalMinor: FIXTURE_SLOT_PRICE_MINOR * 10,
      maxBookings: 10,
      allowedLocalities: ['Connaught Place'],
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2027-01-01T00:00:00.000Z',
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

interface OrderResponse {
  orderId: string;
  amountMinor: number;
  notes: Record<string, string>;
}

async function createOrder(
  app: INestApplication,
  token: string,
  body: { tableId: string; slotId: string; holdId: string; mandateId?: string; agentId?: string },
): Promise<request.Response> {
  return request(app.getHttpServer())
    .post('/payments/orders')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/**
 * Issue #8 (PRD area E): real test-mode money behind the `PAYMENT_PROVIDER`
 * switch — order creation gated by the mandate preview, the signed webhook
 * as the source of truth for payment, and the webhook/agent-confirm race
 * converging on one idempotency key. `RazorpayClient` stays in its stub mode
 * throughout (no RAZORPAY_KEY_ID/SECRET in the test env), so every call here
 * exercises the real webhook route and the real `confirmHold` machinery
 * without any network access to Razorpay.
 */
describe('Razorpay payments (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    process.env.PAYMENT_PROVIDER = 'razorpay';
    await truncateAll(app);
    fixture = await seedFixture(app);
  });

  afterAll(async () => {
    delete process.env.PAYMENT_PROVIDER;
    await app.close();
  });

  describe('order creation — the provider switch and the gate', () => {
    it('refuses to create an order when the active provider is wallet, not razorpay', async () => {
      process.env.PAYMENT_PROVIDER = 'wallet';
      const { token } = await signup(app, 'wallet-mode@example.com');
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);

      await createOrder(app, token, { tableId: fixture.tableId, slotId: fixture.slotId, holdId }).then((r) =>
        expect(r.status).toBe(400),
      );
    });

    it('creates an order carrying the required notes, priced at the slot', async () => {
      const razorpay = app.get(RazorpayClient);
      const before = razorpay.stubOrderCount;
      const { token, userId } = await signup(app, 'notes-roundtrip@example.com');
      const mandateId = await grantMandate(app, token);
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);

      const res = await createOrder(app, token, {
        tableId: fixture.tableId,
        slotId: fixture.slotId,
        holdId,
        mandateId,
        agentId: 'agent-123',
      }).then((r) => r as request.Response & { body: OrderResponse });
      expect(res.status).toBe(201);
      expect(res.body.amountMinor).toBe(FIXTURE_SLOT_PRICE_MINOR);
      expect(res.body.notes).toEqual({
        mandateId,
        agentId: 'agent-123',
        userId,
        holdId,
        idempotencyKey: expect.any(String),
      });
      expect(razorpay.stubOrderCount).toBe(before + 1);
    });

    it('denies order creation when the mandate would refuse it, and creates no Razorpay order', async () => {
      const razorpay = app.get(RazorpayClient);
      const before = razorpay.stubOrderCount;
      const { token } = await signup(app, 'notes-denied@example.com');
      const mandateId = await grantMandate(app, token, { maxPerBookingMinor: FIXTURE_SLOT_PRICE_MINOR - 1 });
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);

      const res = await createOrder(app, token, { tableId: fixture.tableId, slotId: fixture.slotId, holdId, mandateId });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ verdict: 'DENY', reason: 'per_booking_ceiling_exceeded' });
      expect(razorpay.stubOrderCount).toBe(before);
    });
  });

  describe('webhook — signature verification and capture', () => {
    it('rejects a wrong-secret payload before it can touch any booking state', async () => {
      const { token } = await signup(app, 'wrong-secret@example.com');
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);
      const order = await createOrder(app, token, { tableId: fixture.tableId, slotId: fixture.slotId, holdId }).then(
        (r) => r.body as OrderResponse,
      );

      const payload = capturedPayload(order.orderId, 'pay_wrong', order.amountMinor, order.notes);
      const { raw } = signPayload(payload, WEBHOOK_SECRET);
      const wrongSignature = createHmac('sha256', 'not-the-real-secret').update(raw).digest('hex');

      await postWebhook(app, raw, wrongSignature).expect(401);

      const reservationRepo = app.get(DataSource).getRepository(Reservation);
      expect(await reservationRepo.count()).toBe(0);
    });

    it('a correctly signed payment.captured event commits the booking and records the payment id', async () => {
      const { token } = await signup(app, 'captured@example.com');
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);
      const order = await createOrder(app, token, { tableId: fixture.tableId, slotId: fixture.slotId, holdId }).then(
        (r) => r.body as OrderResponse,
      );

      const payload = capturedPayload(order.orderId, 'pay_captured_1', order.amountMinor, order.notes);
      const { raw, signature } = signPayload(payload, WEBHOOK_SECRET);

      await postWebhook(app, raw, signature).expect(200);

      const reservationRepo = app.get(DataSource).getRepository(Reservation);
      expect(await reservationRepo.count()).toBe(1);
      const paymentRepo = app.get(DataSource).getRepository(Payment);
      const payment = await paymentRepo.findOneByOrFail({ reservationId: (await reservationRepo.find())[0].id });
      expect(payment.razorpayPaymentId).toBe('pay_captured_1');
      expect(payment.amount).toBe(FIXTURE_SLOT_PRICE_MINOR);
    });

    it('the same captured event redelivered books exactly once', async () => {
      const { token } = await signup(app, 'redelivered@example.com');
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);
      const order = await createOrder(app, token, { tableId: fixture.tableId, slotId: fixture.slotId, holdId }).then(
        (r) => r.body as OrderResponse,
      );

      const payload = capturedPayload(order.orderId, 'pay_redelivered', order.amountMinor, order.notes);
      const { raw, signature } = signPayload(payload, WEBHOOK_SECRET);

      await postWebhook(app, raw, signature).expect(200);
      await postWebhook(app, raw, signature).expect(200);

      const reservationRepo = app.get(DataSource).getRepository(Reservation);
      expect(await reservationRepo.count()).toBe(1);
      const paymentRepo = app.get(DataSource).getRepository(Payment);
      expect(await paymentRepo.count()).toBe(1);
      const payment = (await paymentRepo.find())[0];
      expect(payment.razorpayPaymentId).toBe('pay_redelivered');
    });
  });

  describe('webhook vs. the agent/user\'s own confirm — racing on one idempotency key', () => {
    it('produces exactly one booking no matter which arrives first', async () => {
      const { token } = await signup(app, 'race@example.com');
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);
      const order = await createOrder(app, token, { tableId: fixture.tableId, slotId: fixture.slotId, holdId }).then(
        (r) => r.body as OrderResponse,
      );

      const payload = capturedPayload(order.orderId, 'pay_race', order.amountMinor, order.notes);
      const { raw, signature } = signPayload(payload, WEBHOOK_SECRET);

      const webhookCall = postWebhook(app, raw, signature);
      const confirmCall = request(app.getHttpServer())
        .post('/reservations/confirm')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', order.notes.idempotencyKey)
        .send({ holdId, tableId: fixture.tableId, slotId: fixture.slotId });

      const [webhookRes, confirmRes] = await Promise.all([webhookCall, confirmCall]);

      expect([200, 409]).toContain(webhookRes.status);
      expect([201, 409]).toContain(confirmRes.status);

      const reservationRepo = app.get(DataSource).getRepository(Reservation);
      expect(await reservationRepo.count()).toBe(1);
      const paymentRepo = app.get(DataSource).getRepository(Payment);
      expect(await paymentRepo.count()).toBe(1);
    });
  });

  /**
   * Issue #9 (PRD area E): a capture that already happened at Razorpay
   * followed by a confirm that fails — the hold is consumed (and so the
   * slot free) before the failure, so compensation is refund-only.
   */
  describe('compensation — capture succeeds, confirm fails', () => {
    it('a mandate exhausted in the gap refunds the payment, logs a compensate decision, and leaves the slot bookable', async () => {
      const razorpay = app.get(RazorpayClient);
      const refundsBefore = razorpay.stubRefunds.length;
      const { token } = await signup(app, 'compensate-mandate@example.com');
      const mandateId = await grantMandate(app, token, { maxBookings: 1 });

      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);
      const order = await createOrder(app, token, {
        tableId: fixture.tableId,
        slotId: fixture.slotId,
        holdId,
        mandateId,
      }).then((r) => r.body as OrderResponse);

      // A concurrent booking exhausts the mandate's single allowed booking
      // while this buyer is at checkout — the genuine capture-then-deny the
      // issue calls for, not an injected failure. It's a different slot,
      // more than 10 hours from the fixture's, so it trips the mandate's
      // `bookings_exhausted` ceiling rather than the unrelated 10-hour
      // one-booking-per-café window rule.
      const slotRepo = app.get(DataSource).getRepository(Slot);
      const farSlot = await slotRepo.save(
        slotRepo.create({
          cafeId: fixture.cafeId,
          slotTime: new Date(fixture.slotTime.getTime() + 24 * 60 * 60 * 1000),
          priceMinor: FIXTURE_SLOT_PRICE_MINOR,
        }),
      );
      const raceHoldId = await createHold(app, token, fixture.otherTableId, farSlot.id);
      await request(app.getHttpServer())
        .post('/reservations/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ holdId: raceHoldId, tableId: fixture.otherTableId, slotId: farSlot.id, mandateId })
        .expect(201);

      const payload = capturedPayload(order.orderId, 'pay_compensate_1', order.amountMinor, order.notes);
      const { raw, signature } = signPayload(payload, WEBHOOK_SECRET);

      await postWebhook(app, raw, signature).expect(200);

      const reservationRepo = app.get(DataSource).getRepository(Reservation);
      expect(await reservationRepo.count()).toBe(1); // only the race booking
      const paymentRepo = app.get(DataSource).getRepository(Payment);
      expect(await paymentRepo.count()).toBe(1);

      expect(razorpay.stubRefunds.length).toBe(refundsBefore + 1);
      expect(razorpay.stubRefunds[razorpay.stubRefunds.length - 1]).toEqual({
        paymentId: 'pay_compensate_1',
        amountMinor: order.amountMinor,
      });

      const trace = await request(app.getHttpServer())
        .get('/agent/decisions')
        .query({ mandateId })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const compensateRow = (trace.body as { step: string; denyReason: string | null }[]).find(
        (row) => row.step === 'compensate',
      );
      expect(compensateRow).toBeDefined();
      expect(compensateRow?.denyReason).toBe('bookings_exhausted');

      // The slot is bookable again: a fresh, mandate-free hold+confirm on
      // the original table succeeds.
      const freshHoldId = await createHold(app, token, fixture.tableId, fixture.slotId);
      await request(app.getHttpServer())
        .post('/reservations/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ holdId: freshHoldId, tableId: fixture.tableId, slotId: fixture.slotId })
        .expect(201);
    });

    it('a slot taken in the gap is refunded even with no mandate involved', async () => {
      const razorpay = app.get(RazorpayClient);
      const refundsBefore = razorpay.stubRefunds.length;
      const { token } = await signup(app, 'compensate-no-mandate@example.com');
      const holdId = await createHold(app, token, fixture.tableId, fixture.slotId);
      const order = await createOrder(app, token, {
        tableId: fixture.tableId,
        slotId: fixture.slotId,
        holdId,
      }).then((r) => r.body as OrderResponse);

      // Someone else books the exact same table/slot directly while this
      // buyer is at checkout.
      const { token: racerToken } = await signup(app, 'racer@example.com');
      await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${racerToken}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotId })
        .expect(201);

      const payload = capturedPayload(order.orderId, 'pay_compensate_2', order.amountMinor, order.notes);
      const { raw, signature } = signPayload(payload, WEBHOOK_SECRET);

      await postWebhook(app, raw, signature).expect(200);

      const reservationRepo = app.get(DataSource).getRepository(Reservation);
      expect(await reservationRepo.count()).toBe(1); // only the racer's booking
      const paymentRepo = app.get(DataSource).getRepository(Payment);
      expect(await paymentRepo.count()).toBe(1);

      expect(razorpay.stubRefunds.length).toBe(refundsBefore + 1);
      expect(razorpay.stubRefunds[razorpay.stubRefunds.length - 1]).toEqual({
        paymentId: 'pay_compensate_2',
        amountMinor: order.amountMinor,
      });
    });
  });
});
