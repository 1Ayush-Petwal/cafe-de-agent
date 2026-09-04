/**
 * Issue #3 (PRD area A): the wallet moved from whole rupees to integer
 * paise, so it takes a real number from a real Razorpay-boundary unit. There
 * is no longer a flat per-booking charge — the charge is the slot's own
 * `priceMinor`, resolved in `writeBookingAndCharge`.
 */
export const WALLET_SIGNUP_BALANCE = 50000;
