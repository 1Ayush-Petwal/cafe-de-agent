/**
 * PRD area F (issue #10, "Cold slots get nudged"): a slot's demand score
 * blends two signals of different speed — how this café/weekday/hour has
 * historically filled (slow, structural, needs seeded history) and how many
 * of this exact slot's tables are held right now (fast, live). See
 * CafesService.getAvailability for how each half is actually queried; this
 * module is the pure arithmetic both that method and its tests share.
 */
export const HISTORICAL_FILL_WEIGHT = 0.7;
export const HOLD_PRESSURE_WEIGHT = 0.3;

/** Below this, a slot is cold — the score is deliberately unitless 0..1. */
export const COLD_THRESHOLD = 0.35;

/** A hot slot is never discounted at any size; only a cold one reaches this at all. */
export const MAX_DISCOUNT_FRACTION = 0.2;

export function computeDemandScore(historicalFillRate: number, currentHoldPressure: number): number {
  return historicalFillRate * HISTORICAL_FILL_WEIGHT + currentHoldPressure * HOLD_PRESSURE_WEIGHT;
}

export function isCold(demandScore: number): boolean {
  return demandScore < COLD_THRESHOLD;
}

/**
 * `nudgeMinor = min(0.20 * priceMinor, cafe.maxDiscountMinor)`, cold slots
 * only — capping the discount at both a percentage of price and the owner's
 * absolute floor is what keeps the mechanic from ever destroying margin.
 */
export function nudgeMinor(priceMinor: number, maxDiscountMinor: number, cold: boolean): number {
  if (!cold) return 0;
  return Math.min(Math.round(priceMinor * MAX_DISCOUNT_FRACTION), maxDiscountMinor);
}
