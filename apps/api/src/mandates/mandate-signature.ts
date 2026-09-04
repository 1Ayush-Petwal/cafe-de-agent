import { createHmac } from 'crypto';

/**
 * The constraints a mandate signs — deliberately excludes `consumedMinor`/
 * `consumedBookings`: including them would invalidate the signature on
 * every spend (PRD area B). Field order here is the canonical order; two
 * mandates with identical bounds always sign to the same digest.
 */
export interface MandateConstraints {
  maxPerBookingMinor: number;
  maxTotalMinor: number;
  maxBookings: number;
  allowedLocalities: string[];
  windowStart: string;
  windowEnd: string;
}

function canonicalize(constraints: MandateConstraints): string {
  return JSON.stringify({
    maxPerBookingMinor: constraints.maxPerBookingMinor,
    maxTotalMinor: constraints.maxTotalMinor,
    maxBookings: constraints.maxBookings,
    allowedLocalities: constraints.allowedLocalities,
    windowStart: constraints.windowStart,
    windowEnd: constraints.windowEnd,
  });
}

function serverSecret(): string {
  return process.env.SERVER_SECRET ?? 'dev-secret-change-me';
}

/** Non-repudiation record of exactly which bounds the human agreed to — never accepted as a credential. */
export function signMandateConstraints(constraints: MandateConstraints): string {
  return createHmac('sha256', serverSecret()).update(canonicalize(constraints)).digest('hex');
}
