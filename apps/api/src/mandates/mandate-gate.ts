import { MandateStatus } from '../entities/mandate-status.enum';
import { Mandate } from '../entities/mandate.entity';
import { MandateDenyReason } from './mandate-deny-reason.enum';

/** What a candidate booking looks like to the gate — resolved from its slot/table/cafe by the caller. */
export interface MandateCheckInput {
  amountMinor: number;
  locality: string;
  slotTime: Date;
}

export type MandateGateResult = { verdict: 'ALLOW' } | { verdict: 'DENY'; reason: MandateDenyReason };

/** Issue #6 (PRD area C): the mandate's constraint and consumption state, frozen for the decision log. */
export interface MandateConstraintsSnapshot {
  maxPerBookingMinor: number;
  maxTotalMinor: number;
  maxBookings: number;
  allowedLocalities: string[];
  windowStart: string;
  windowEnd: string;
  consumedMinor: number;
  consumedBookings: number;
  status: MandateStatus;
  expiresAt: string;
  revokedAt: string | null;
}

export function snapshotConstraints(mandate: Mandate): MandateConstraintsSnapshot {
  return {
    maxPerBookingMinor: mandate.maxPerBookingMinor,
    maxTotalMinor: mandate.maxTotalMinor,
    maxBookings: mandate.maxBookings,
    allowedLocalities: mandate.allowedLocalities,
    windowStart: mandate.windowStart.toISOString(),
    windowEnd: mandate.windowEnd.toISOString(),
    consumedMinor: mandate.consumedMinor,
    consumedBookings: mandate.consumedBookings,
    status: mandate.status,
    expiresAt: mandate.expiresAt.toISOString(),
    revokedAt: mandate.revokedAt ? mandate.revokedAt.toISOString() : null,
  };
}

/**
 * The single source of truth for "why would this mandate refuse this booking" —
 * shared by the read-only preview and by {@link authorizeAndConsume}'s
 * post-mortem lookup (called only after the atomic UPDATE has already
 * decided pass/fail, purely to explain a denial; this function never itself
 * decides the binding outcome). Order is priority: lifecycle states before
 * ceilings, ceilings before locality/window, so a mandate that fails on
 * several axes at once still reports one deterministic reason.
 */
export function evaluateMandate(mandate: Mandate, input: MandateCheckInput, now: Date = new Date()): MandateGateResult {
  if (mandate.status === MandateStatus.REVOKED) {
    return { verdict: 'DENY', reason: MandateDenyReason.REVOKED };
  }
  if (mandate.expiresAt <= now) {
    return { verdict: 'DENY', reason: MandateDenyReason.EXPIRED };
  }
  if (mandate.consumedBookings + 1 > mandate.maxBookings) {
    return { verdict: 'DENY', reason: MandateDenyReason.BOOKINGS_EXHAUSTED };
  }
  if (input.amountMinor > mandate.maxPerBookingMinor) {
    return { verdict: 'DENY', reason: MandateDenyReason.PER_BOOKING_CEILING_EXCEEDED };
  }
  if (mandate.consumedMinor + input.amountMinor > mandate.maxTotalMinor) {
    return { verdict: 'DENY', reason: MandateDenyReason.TOTAL_CEILING_EXCEEDED };
  }
  if (!mandate.allowedLocalities.includes(input.locality)) {
    return { verdict: 'DENY', reason: MandateDenyReason.LOCALITY_MISMATCH };
  }
  if (input.slotTime < mandate.windowStart || input.slotTime > mandate.windowEnd) {
    return { verdict: 'DENY', reason: MandateDenyReason.WINDOW_MISMATCH };
  }
  return { verdict: 'ALLOW' };
}
