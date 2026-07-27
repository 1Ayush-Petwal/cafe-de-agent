# 10-hour booking window: one active reservation per user per café

> Local mirror of [1Ayush-Petwal/Project-1/issues/17](https://github.com/1Ayush-Petwal/Project-1/issues/17) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area B)

## What to build

A user may hold only one active reservation per café within any rolling 10-hour window. When booking/holding a slot at café X with slot time T, reject if the user already has a reservation with status `booked` at café X whose slot time satisfies |existing − T| < 10 hours. Cancelled reservations never count; different cafés are fully independent.

Enforced once in the reservations service and applied at all three entry points: hold creation (fail fast, before the Redis hold is taken and before checkout starts), direct book, and confirm execution (authoritative, alongside the write). The AI booking agent books through the same service, so it inherits the rule with zero agent-side work. A violation returns HTTP 409 naming the conflicting booking's slot time so the customer knows what to cancel.

Deliberately no DB-level exclusion constraint (would require denormalizing café + slot time onto reservations plus a GiST index); the app-level check leaves a small same-user self-race window, accepted per the PRD — revisit only if observed.

## Acceptance criteria

- [ ] Second booking at the same café within 10h of an existing booked reservation → 409 naming the existing booking's slot time
- [ ] Bookings ≥10h apart at the same café are allowed
- [ ] Same-evening bookings at two different cafés are allowed
- [ ] Cancelling a reservation immediately frees the user to book that café again
- [ ] The hold endpoint rejects the conflict before a hold is taken
- [ ] Bookings placed via the AI agent are bound by the same rule
- [ ] e2e specs at the existing HTTP seam (supertest, real Postgres/Redis) cover all of the above

## Blocked by

None - can start immediately
