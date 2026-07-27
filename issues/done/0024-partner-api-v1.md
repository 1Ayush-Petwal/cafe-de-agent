# Partner API v1: per-café API keys, booking webhooks via outbox, pull endpoints

> Local mirror of [1Ayush-Petwal/Project-1/issues/24](https://github.com/1Ayush-Petwal/Project-1/issues/24) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area G; the PRD specifies this, this issue builds it)

## What to build

Partner API v1 — one-way sync from our platform to a café's local app.

Per-café API keys: an owner generates and revokes keys from their dashboard; each key is scoped to that café only and hashed at rest. Webhooks out: the owner registers their local app's endpoint; booking.created and booking.cancelled events for their café are delivered via the existing transactional-outbox + worker pattern (a second consumer of the mechanism that already guarantees notification jobs commit atomically with bookings), with retries on delivery failure. Pull endpoints: café-scoped bookings-by-date and availability-by-date, API-key authenticated, for reconciliation after partner downtime.

Two-way sync (the partner's app blocking our slots) is explicitly v2 and out of scope — it makes their system a second writer into our inventory. Interim stopgap: the existing take-table-out-of-service owner control.

## Acceptance criteria

- [ ] Owner can generate and revoke a café-scoped API key from the dashboard; keys hashed at rest
- [ ] A key only grants access to its own café's data (cross-café request → 403/404)
- [ ] Booking confirmed → booking.created webhook delivered to the registered endpoint; cancelled → booking.cancelled
- [ ] Webhook payload commits atomically with the booking (outbox), and delivery retries on failure
- [ ] Pull endpoints return the café's bookings and availability for a given date, API-key authenticated
- [ ] Revoked key → all partner requests rejected
- [ ] e2e specs at the existing HTTP seam cover key lifecycle, scoping, pull endpoints, and outbox event enqueueing
- [ ] No two-way sync: no endpoint lets a partner create or block reservations

## Blocked by

- 1Ayush-Petwal/Project-1#21 — webhook/payload shapes must reflect the final booking + wallet-payment flow
