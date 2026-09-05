import { computeSlotPriceMinor } from '../../src/pricing/slot-price';
import { createRng } from '../../src/seed/rng';
import { dailySlotTimes } from '../../src/seed/slot-grid';

/**
 * Issue #11 (PRD area G): the harness's fixed demand. A future date and a
 * small café roster, independent of anything in the database — every field
 * on a {@link HarnessIntent} is computed from `seed` and the intent's index
 * alone, so `generateIntents` is a pure function and both arms (and every
 * rerun) face byte-identical synthetic buyers.
 */
export const HARNESS_FUTURE_DATE = '2026-09-20';
export const HARNESS_CAFE_AREAS = ['Hauz Khas', 'GK-II', 'Connaught Place'];
export const HARNESS_TABLES_PER_CAFE = 2;
export const HARNESS_PRICE_BAND_MINOR = 40000;

/**
 * Fraction of intents whose mandate is deliberately too narrow to allow an
 * otherwise-fillable booking — kept small (real customers occasionally
 * under-scope a mandate; they don't do it a third of the time) so the
 * mandate gate's over-refusal cost doesn't drown out the slot-fill
 * mechanic's own recovery of requests the baseline arm simply loses.
 */
const LOCALITY_MISMATCH_FRACTION = 0.05;
const PER_BOOKING_CEILING_FRACTION = 0.05;
const WINDOW_MISMATCH_FRACTION = 0.05;
/** PRD §11: "force confirm to throw after a successful capture on ~5% of runs". */
const CHAOS_FRACTION = 0.05;

export interface HarnessMandateSpec {
  maxPerBookingMinor: number;
  maxTotalMinor: number;
  maxBookings: number;
  allowedLocalities: string[];
  windowStart: string;
  windowEnd: string;
}

export interface HarnessIntent {
  id: number;
  cafeIndex: number;
  tableIndex: number;
  hourIndex: number;
  priceMinor: number;
  /** Applied only in the agent arm — the baseline arm ignores this entirely. */
  mandate: HarnessMandateSpec;
  /** This intent's capture is forced into a genuine capture-then-deny race. */
  chaos: boolean;
}

/**
 * A fixed-seed generator: the same `(seed, count)` always produces the same
 * intents, in the same order, with no DB access — the source-of-truth demand
 * both arms are run against.
 */
export function generateIntents(seed: number, count: number): HarnessIntent[] {
  const rng = createRng(seed);
  const hours = dailySlotTimes(HARNESS_FUTURE_DATE);
  const intents: HarnessIntent[] = [];

  for (let id = 0; id < count; id++) {
    const cafeIndex = Math.floor(rng() * HARNESS_CAFE_AREAS.length);
    const tableIndex = Math.floor(rng() * HARNESS_TABLES_PER_CAFE);
    const hourIndex = Math.floor(rng() * hours.length);
    const slotTime = hours[hourIndex];
    const priceMinor = computeSlotPriceMinor(HARNESS_PRICE_BAND_MINOR, slotTime);

    let allowedLocalities = [HARNESS_CAFE_AREAS[cafeIndex]];
    let maxPerBookingMinor = priceMinor * 5;
    let windowStart = '2026-01-01T00:00:00.000Z';
    let windowEnd = '2027-01-01T00:00:00.000Z';

    // Mutually exclusive deny-shape rolls, each carved out of its own slice
    // of the roll so the fractions above are the actual observed rates.
    const denyRoll = rng();
    if (denyRoll < LOCALITY_MISMATCH_FRACTION) {
      allowedLocalities = [HARNESS_CAFE_AREAS[(cafeIndex + 1) % HARNESS_CAFE_AREAS.length]];
    } else if (denyRoll < LOCALITY_MISMATCH_FRACTION + PER_BOOKING_CEILING_FRACTION) {
      maxPerBookingMinor = Math.max(1, priceMinor - 1);
    } else if (denyRoll < LOCALITY_MISMATCH_FRACTION + PER_BOOKING_CEILING_FRACTION + WINDOW_MISMATCH_FRACTION) {
      // Expires at the start of the harness date — every slot that day (09:00+) falls outside it.
      windowEnd = `${HARNESS_FUTURE_DATE}T00:00:00.000Z`;
    }

    const chaos = rng() < CHAOS_FRACTION;

    intents.push({
      id,
      cafeIndex,
      tableIndex,
      hourIndex,
      priceMinor,
      mandate: {
        maxPerBookingMinor,
        maxTotalMinor: priceMinor * 20,
        maxBookings: 1,
        allowedLocalities,
        windowStart,
        windowEnd,
      },
      chaos,
    });
  }

  return intents;
}
