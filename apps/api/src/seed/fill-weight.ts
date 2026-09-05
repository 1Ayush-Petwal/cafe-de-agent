import { isWeekend } from '../pricing/slot-price';

/**
 * Issue #10 (PRD area F): the probability a past (table, slot) pair got
 * booked when generating seed history, by hour band — same named bands as
 * `pricing/slot-price.ts`'s price multipliers, since the same hours that
 * cost more are the ones that historically sell out. Deliberately a
 * separate table from price: these are booking probabilities, not price
 * multipliers, and happen to share band boundaries rather than values.
 */
const DINNER_PEAK_WEIGHT = 0.85;
const EARLY_EVENING_WEIGHT = 0.55;
const LUNCH_WEIGHT = 0.45;
const OFF_PEAK_WEIGHT = 0.15;
const WEEKEND_MULTIPLIER = 1.3;

function baseFillWeight(hourUtc: number): number {
  if (hourUtc >= 19 && hourUtc < 21) return DINNER_PEAK_WEIGHT;
  if (hourUtc === 17) return EARLY_EVENING_WEIGHT;
  if (hourUtc >= 12 && hourUtc < 14) return LUNCH_WEIGHT;
  return OFF_PEAK_WEIGHT;
}

/** A probability in 0..1 — the weekend multiplier is capped rather than allowed past 1. */
export function historicalFillWeight(slotTime: Date): number {
  const weight = baseFillWeight(slotTime.getUTCHours()) * (isWeekend(slotTime.getUTCDay()) ? WEEKEND_MULTIPLIER : 1);
  return Math.min(1, weight);
}
