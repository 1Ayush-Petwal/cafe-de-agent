export const OPENING_HOUR_UTC = 9;
export const CLOSING_HOUR_UTC = 22;
export const TURN_TIME_MINUTES = 60;

/** Start times for one day's slot grid, 09:00-22:00 UTC in 60-minute steps. */
export function dailySlotTimes(dateOnly: string): Date[] {
  const slots: Date[] = [];
  for (let hour = OPENING_HOUR_UTC; hour < CLOSING_HOUR_UTC; hour++) {
    slots.push(new Date(`${dateOnly}T${String(hour).padStart(2, '0')}:00:00.000Z`));
  }
  return slots;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
