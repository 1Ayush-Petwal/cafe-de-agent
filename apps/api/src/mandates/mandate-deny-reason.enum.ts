/**
 * Issue #5 (PRD area B): every way the gate can refuse gets its own reason —
 * a merged "ceiling exceeded" bucket would defeat the PRD's "replayable
 * refusal" requirement (area C's decision log stores this verbatim).
 */
export enum MandateDenyReason {
  REVOKED = 'revoked',
  EXPIRED = 'expired',
  BOOKINGS_EXHAUSTED = 'bookings_exhausted',
  PER_BOOKING_CEILING_EXCEEDED = 'per_booking_ceiling_exceeded',
  TOTAL_CEILING_EXCEEDED = 'total_ceiling_exceeded',
  LOCALITY_MISMATCH = 'locality_mismatch',
  WINDOW_MISMATCH = 'window_mismatch',
}
