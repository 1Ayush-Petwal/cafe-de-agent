import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Payment } from '../../src/entities/payment.entity';
import { ReservationStatus } from '../../src/entities/reservation-status.enum';
import { Reservation } from '../../src/entities/reservation.entity';
import { RazorpayClient } from '../../src/payments/razorpay.client';
import { capturedPayload, postWebhook, signPayload, WEBHOOK_SECRET } from '../../test/utils/razorpay-webhook';
import { HarnessFixture } from './fixture';
import { HARNESS_FUTURE_DATE, HarnessIntent } from './intents';

export type HarnessArm = 'baseline' | 'agent';

export interface DenialCounts {
  total: number;
  byReason: Record<string, number>;
}

export interface ArmMetrics {
  arm: HarnessArm;
  totalIntents: number;
  filled: number;
  grossRevenueMinor: number;
  mandateDenials: DenialCounts;
  platformDenials: DenialCounts;
  compensations: { ok: number; failed: number };
}

function emptyDenials(): DenialCounts {
  return { total: 0, byReason: {} };
}

function recordDenial(denials: DenialCounts, reason: string): void {
  denials.total += 1;
  denials.byReason[reason] = (denials.byReason[reason] ?? 0) + 1;
}

interface OrderResponse {
  orderId: string;
  amountMinor: number;
  notes: Record<string, string>;
}

async function signup(app: INestApplication, email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function tryHold(app: INestApplication, token: string, tableId: string, slotId: string): Promise<string | null> {
  const res = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, slotId });
  return res.status === 201 ? (res.body.holdId as string) : null;
}

async function grantMandate(app: INestApplication, token: string, spec: HarnessIntent['mandate']): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/mandates')
    .set('Authorization', `Bearer ${token}`)
    .send(spec)
    .expect(201);
  return res.body.id as string;
}

async function createOrder(
  app: INestApplication,
  token: string,
  body: { tableId: string; slotId: string; holdId: string; mandateId?: string },
): Promise<request.Response> {
  return request(app.getHttpServer())
    .post('/payments/orders')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** Every candidate `findAlternatives` returns is already mandate-screened (issue #10) — take the first one that's still holdable. */
async function claimFirstAlternative(
  app: INestApplication,
  token: string,
  cafeId: string,
  excludeSlotId: string,
  mandateId: string | undefined,
): Promise<{ tableId: string; slotId: string; holdId: string } | null> {
  const res = await request(app.getHttpServer())
    .get(`/cafes/${cafeId}/alternatives`)
    .set('Authorization', `Bearer ${token}`)
    .query({ date: HARNESS_FUTURE_DATE, excludeSlotId, ...(mandateId ? { mandateId } : {}) })
    .expect(200);
  const candidates = res.body as { tableId: string; slotId: string }[];
  for (const candidate of candidates) {
    const holdId = await tryHold(app, token, candidate.tableId, candidate.slotId);
    if (holdId) {
      return { tableId: candidate.tableId, slotId: candidate.slotId, holdId };
    }
  }
  return null;
}

/**
 * A genuine "slot taken in the gap" race (the same mechanism
 * `razorpay.e2e-spec.ts` uses): a throwaway buyer books the exact table+slot
 * directly, bypassing the hold system entirely, between order creation and
 * webhook delivery. Direct book has no Razorpay flow, so this never touches
 * the arm under test's own payment state — it only ensures the row the
 * webhook's `confirmHold` tries to insert is already taken by the time it
 * runs, producing a real capture-then-deny rather than an injected one.
 */
async function raceSlotAway(app: INestApplication, tableId: string, slotId: string, raceEmail: string): Promise<void> {
  const { token } = await signup(app, raceEmail);
  await request(app.getHttpServer())
    .post('/reservations')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, slotId })
    .expect(201);
}

/**
 * Runs one arm's fixed demand end to end. Sequential by design — each
 * intent's webhook lands before the next intent starts — so a natural
 * collision between two intents targeting the same (café, table, hour)
 * shows up as an ordinary "slot unavailable" hold failure, never as a race;
 * the only capture-then-deny races are the deliberately `chaos`-flagged ones.
 */
export async function runArm(
  app: INestApplication,
  arm: HarnessArm,
  intents: HarnessIntent[],
  fixture: HarnessFixture,
): Promise<ArmMetrics> {
  const metrics: ArmMetrics = {
    arm,
    totalIntents: intents.length,
    filled: 0,
    grossRevenueMinor: 0,
    mandateDenials: emptyDenials(),
    platformDenials: emptyDenials(),
    compensations: { ok: 0, failed: 0 },
  };

  const dataSource = app.get(DataSource);
  const reservationRepo = dataSource.getRepository(Reservation);
  const paymentRepo = dataSource.getRepository(Payment);
  const razorpay = app.get(RazorpayClient);

  for (const intent of intents) {
    const cafe = fixture.cafes[intent.cafeIndex];
    const requestedTableId = cafe.tableIds[intent.tableIndex];
    const requestedSlotId = cafe.slotIds[intent.hourIndex];

    const { token, userId } = await signup(app, `harness-${arm}-${intent.id}@cafedeagent.local`);

    const mandateId = arm === 'agent' ? await grantMandate(app, token, intent.mandate) : undefined;

    let tableId = requestedTableId;
    let slotId = requestedSlotId;
    let holdId = await tryHold(app, token, tableId, slotId);

    if (!holdId && arm === 'agent') {
      const alternative = await claimFirstAlternative(app, token, cafe.cafeId, requestedSlotId, mandateId);
      if (alternative) {
        tableId = alternative.tableId;
        slotId = alternative.slotId;
        holdId = alternative.holdId;
      }
    }

    if (!holdId) {
      recordDenial(metrics.platformDenials, 'slot_unavailable');
      continue;
    }

    const orderRes = await createOrder(app, token, { tableId, slotId, holdId, mandateId });
    if (orderRes.status === 403) {
      recordDenial(metrics.mandateDenials, orderRes.body.reason as string);
      continue;
    }
    const order = orderRes.body as OrderResponse;

    if (intent.chaos) {
      await raceSlotAway(app, tableId, slotId, `harness-${arm}-${intent.id}-racer@cafedeagent.local`);
    }

    const refundsBefore = razorpay.stubRefunds.length;
    const { raw, signature } = signPayload(
      capturedPayload(order.orderId, `pay_${arm}_${intent.id}`, order.amountMinor, order.notes),
      WEBHOOK_SECRET,
    );
    await postWebhook(app, raw, signature);

    const booked = await reservationRepo.findOne({
      where: { tableId, slotId, userId, status: ReservationStatus.BOOKED },
    });

    if (booked) {
      const payment = await paymentRepo.findOneOrFail({ where: { reservationId: booked.id } });
      metrics.filled += 1;
      metrics.grossRevenueMinor += payment.amount;
      continue;
    }

    const gotRefund = razorpay.stubRefunds.length > refundsBefore;
    if (intent.chaos) {
      if (gotRefund) metrics.compensations.ok += 1;
      else metrics.compensations.failed += 1;
    } else if (gotRefund) {
      // A capture-then-deny nobody engineered — the same genuine race the
      // PRD says the harness's injected failures merely supplement.
      metrics.compensations.ok += 1;
    } else {
      recordDenial(metrics.platformDenials, 'confirm_failed_unexpectedly');
    }
  }

  return metrics;
}
