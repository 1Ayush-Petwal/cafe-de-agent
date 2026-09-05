import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CafeTable } from '../../src/entities/cafe-table.entity';
import { Cafe } from '../../src/entities/cafe.entity';
import { ReservationStatus } from '../../src/entities/reservation-status.enum';
import { Reservation } from '../../src/entities/reservation.entity';
import { Slot } from '../../src/entities/slot.entity';
import { capturedPayload, postWebhook, signPayload, WEBHOOK_SECRET } from '../../test/utils/razorpay-webhook';

export interface DoubleBookingProbeResult {
  concurrency: number;
  bookings: number;
  doubleBookings: number;
}

interface OrderResponse {
  orderId: string;
  amountMinor: number;
  notes: Record<string, string>;
}

/**
 * Issue #11 acceptance criterion: "double bookings asserted to be zero
 * under concurrent retry, as a test rather than a script." Fires the same
 * signed `payment.captured` payload — Razorpay's own at-least-once
 * redelivery contract — at the webhook route N times concurrently, and
 * counts how many bookings resulted. The idempotency-key claim/replay
 * machinery (issue #11's substrate namesake) is what should keep this at
 * exactly one; every other redelivery must replay rather than re-book.
 */
export async function runDoubleBookingProbe(app: INestApplication, concurrency = 10): Promise<DoubleBookingProbeResult> {
  const dataSource = app.get(DataSource);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);
  const reservationRepo = dataSource.getRepository(Reservation);

  const cafe = await cafeRepo.save(cafeRepo.create({ name: 'Concurrency Probe Café', area: 'Hauz Khas' }));
  const table = await tableRepo.save(tableRepo.create({ cafeId: cafe.id, label: 'P1', capacity: 2 }));
  const slot = await slotRepo.save(
    slotRepo.create({ cafeId: cafe.id, slotTime: new Date('2026-09-25T12:00:00.000Z'), priceMinor: 40000 }),
  );

  const signupRes = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email: 'harness-double-booking-probe@cafedeagent.local', password: 'hunter2222' })
    .expect(201);
  const token = signupRes.body.accessToken as string;

  const holdRes = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: table.id, slotId: slot.id })
    .expect(201);
  const holdId = holdRes.body.holdId as string;

  const orderRes = await request(app.getHttpServer())
    .post('/payments/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: table.id, slotId: slot.id, holdId })
    .expect(201);
  const order = orderRes.body as OrderResponse;

  const { raw, signature } = signPayload(
    capturedPayload(order.orderId, 'pay_double_booking_probe', order.amountMinor, order.notes),
    WEBHOOK_SECRET,
  );

  await Promise.allSettled(
    Array.from({ length: concurrency }, () => postWebhook(app, raw, signature)),
  );

  const bookings = await reservationRepo.count({
    where: { tableId: table.id, slotId: slot.id, status: ReservationStatus.BOOKED },
  });

  return { concurrency, bookings, doubleBookings: Math.max(0, bookings - 1) };
}
