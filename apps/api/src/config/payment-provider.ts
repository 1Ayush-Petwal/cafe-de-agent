export type PaymentProvider = 'wallet' | 'razorpay';

/**
 * Issue #8 (PRD area E): the single switch between the fake wallet and real
 * Razorpay test-mode money — read fresh from `process.env` on every charge
 * rather than cached at boot, so `writeBookingAndCharge` and the order-intent
 * seam in `PaymentsService` can never disagree about which provider is
 * active, and tests can flip it per-suite. Exactly one of the two ever
 * charges: `writeBookingAndCharge` runs `chargeWallet` only in 'wallet' mode,
 * since in 'razorpay' mode the money has already moved at Razorpay by the
 * time a webhook (or the racing confirm call) reaches that transaction.
 */
export function paymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === 'razorpay' ? 'razorpay' : 'wallet';
}
