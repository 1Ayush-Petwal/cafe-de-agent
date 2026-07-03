export const OPENING_HOUR_UTC = 9;
export const CLOSING_HOUR_UTC = 22;
export const TURN_TIME_MINUTES = 60;

/** Start times for one day's slot grid, 09:00-22:00 UTC in 60-minute steps. */
export function dailySlotTimes(dateOnly: string): Date[] {
  return dailySlotTimesConfigurable(dateOnly, OPENING_HOUR_UTC, CLOSING_HOUR_UTC, TURN_TIME_MINUTES);
}

/** Same shape as dailySlotTimes but with an owner-configurable grid (issue #8). */
export function dailySlotTimesConfigurable(
  dateOnly: string,
  openHour: number,
  closeHour: number,
  turnTimeMinutes: number,
): Date[] {
  const slots: Date[] = [];
  const dayStart = new Date(`${dateOnly}T00:00:00.000Z`).getTime();
  const rangeStart = dayStart + openHour * 60 * 60 * 1000;
  const rangeEnd = dayStart + closeHour * 60 * 60 * 1000;
  const stepMs = turnTimeMinutes * 60 * 1000;
  for (let t = rangeStart; t < rangeEnd; t += stepMs) {
    slots.push(new Date(t));
  }
  return slots;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
