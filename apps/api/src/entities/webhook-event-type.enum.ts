/** Issue #24 (PRD area G): the two Partner API webhook events — one-way sync only. */
export enum WebhookEventType {
  BOOKING_CREATED = 'booking.created',
  BOOKING_CANCELLED = 'booking.cancelled',
}
