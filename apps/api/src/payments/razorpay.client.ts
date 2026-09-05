import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}

/**
 * Wraps Razorpay's `orders.create` / `payments.refund` behind one injectable
 * class — the established mock-gateway pattern (`NominatimClient`,
 * `AgentLlmClient`). Unlike those, which expose a test-only `.stub()` call,
 * this one selects real-vs-stub by env, per the PRD: real test-mode
 * credentials (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`) switch on live HTTP
 * calls; their absence — every test run, and any dev box without them —
 * uses an in-memory stub, so CI never needs network access to Razorpay to
 * exercise the webhook path end to end.
 */
@Injectable()
export class RazorpayClient {
  private readonly keyId = process.env.RAZORPAY_KEY_ID;
  private readonly keySecret = process.env.RAZORPAY_KEY_SECRET;
  private readonly live = Boolean(this.keyId && this.keySecret);
  private readonly stubOrders = new Map<string, RazorpayOrder>();
  private readonly stubRefundLog: { paymentId: string; amountMinor: number }[] = [];

  /** Test-only introspection: how many orders this stub has created. */
  get stubOrderCount(): number {
    return this.stubOrders.size;
  }

  /** Test-only introspection: every refund this stub has issued, in order. */
  get stubRefunds(): readonly { paymentId: string; amountMinor: number }[] {
    return this.stubRefundLog;
  }

  private liveHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
    };
  }

  async createOrder(amountMinor: number, receipt: string, notes: Record<string, string>): Promise<RazorpayOrder> {
    if (this.live) {
      return this.createOrderLive(amountMinor, receipt, notes);
    }
    const order: RazorpayOrder = { id: `order_stub_${randomUUID()}`, amount: amountMinor, currency: 'INR', receipt, notes };
    this.stubOrders.set(order.id, order);
    return order;
  }

  private async createOrderLive(
    amountMinor: number,
    receipt: string,
    notes: Record<string, string>,
  ): Promise<RazorpayOrder> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: this.liveHeaders(),
      body: JSON.stringify({ amount: amountMinor, currency: 'INR', receipt, notes }),
    });
    if (!res.ok) {
      throw new Error(`Razorpay order creation failed: ${res.status}`);
    }
    return (await res.json()) as RazorpayOrder;
  }

  /** Issue #9 (PRD area E): wired into the confirm-failure compensation path in PaymentsService. */
  async refund(paymentId: string, amountMinor: number): Promise<void> {
    if (!this.live) {
      this.stubRefundLog.push({ paymentId, amountMinor });
      return;
    }
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: this.liveHeaders(),
      body: JSON.stringify({ amount: amountMinor }),
    });
    if (!res.ok) {
      throw new Error(`Razorpay refund failed: ${res.status}`);
    }
  }
}
