/**
 * PRD area A (issue #3): a slot's price is frozen on the row at seed/generate
 * time, never recomputed at read time — a quoted price and a charged price
 * can never diverge. Multipliers per the PRD: 19:00-21:00 (dinner peak)
 * x1.5, 17:00-18:00 (early evening) x1.1, 12:00-14:00 (lunch) x1.0,
 * 15:00-16:00 (afternoon lull) x0.7, further x1.3 on Friday and Saturday.
 * Hours outside those four named bands (morning, and the two gap hours)
 * share the afternoon-lull rate — off-peak demand is comparably low outside
 * the meal-time bands the PRD names explicitly.
 */
const DINNER_PEAK_MULTIPLIER = 1.5;
const EARLY_EVENING_MULTIPLIER = 1.1;
const LUNCH_MULTIPLIER = 1.0;
const OFF_PEAK_MULTIPLIER = 0.7;
const WEEKEND_MULTIPLIER = 1.3;

function hourMultiplier(hourUtc: number): number {
  if (hourUtc >= 19 && hourUtc < 21) return DINNER_PEAK_MULTIPLIER;
  if (hourUtc === 17) return EARLY_EVENING_MULTIPLIER;
  if (hourUtc >= 12 && hourUtc < 14) return LUNCH_MULTIPLIER;
  return OFF_PEAK_MULTIPLIER;
}

function isWeekend(dayUtc: number): boolean {
  return dayUtc === 5 || dayUtc === 6; // Friday, Saturday
}

export function computeSlotPriceMinor(priceBandMinor: number, slotTime: Date): number {
  const multiplier = hourMultiplier(slotTime.getUTCHours()) * (isWeekend(slotTime.getUTCDay()) ? WEEKEND_MULTIPLIER : 1);
  return Math.round(priceBandMinor * multiplier);
}
