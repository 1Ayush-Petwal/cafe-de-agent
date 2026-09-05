/**
 * Issue #3 (PRD area A): the wallet moved from whole rupees to integer
 * paise, so it takes a real number from a real Razorpay-boundary unit. There
 * is no longer a flat per-booking charge — the charge is the slot's own
 * `priceMinor`, resolved in `writeBookingAndCharge`.
 *
 * Sized against the priciest slot the grid can produce, not picked round: a
 * ₹400 band at the weekend dinner-peak multiplier (1.5 x 1.3, see
 * pricing/slot-price.ts) is ₹780, so the old ₹500 could not buy the one slot
 * a demo actually clicks on. It also sits deliberately above the mandate
 * form's ₹1500 default total, so an agent that overspends is stopped by its
 * mandate — the bound we want to show — rather than by a 402 from an empty
 * wallet, which proves nothing about agentic commerce.
 */
export const WALLET_SIGNUP_BALANCE = 200000;
