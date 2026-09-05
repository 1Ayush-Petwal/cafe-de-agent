import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Matches `RAZORPAY_WEBHOOK_SECRET` in test/env.setup.ts. Shared by
 * `razorpay.e2e-spec.ts` and the evaluation harness (issue #11) — both
 * self-sign `payment.captured` payloads into the real webhook route rather
 * than mocking anything below the Razorpay client boundary.
 */
export const WEBHOOK_SECRET = 'test-webhook-secret';

export function capturedPayload(orderId: string, paymentId: string, amount: number, notes: Record<string, string>) {
  return {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: 'payment',
          amount,
          currency: 'INR',
          status: 'captured',
          order_id: orderId,
          notes,
        },
      },
    },
  };
}

export function signPayload(payload: unknown, secret: string): { raw: string; signature: string } {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

export function postWebhook(app: INestApplication, raw: string, signature: string): request.Test {
  return request(app.getHttpServer())
    .post('/payments/webhook/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .send(raw);
}
