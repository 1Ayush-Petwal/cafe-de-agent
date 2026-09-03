# Decision log records intent and refusal

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/6](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/6) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

Every step an agent takes is recorded with what it asked for and what it got, including the refusals. Most submissions log successful bookings; logging refusals with the constraint state that caused them is what makes the trail explainable.

Each row carries a snapshot of the mandate's constraint and consumption state at that instant. That snapshot is the point: it lets a past decision be replayed against the state that caused it rather than the state as it now stands. Rows join the booking transaction where one exists and stand alone where it does not.

One read endpoint returns the ordered trace for a mandate.

## Acceptance criteria

- [ ] Decisions recorded for the propose, authorize, capture, confirm and compensate steps
- [ ] Denials recorded with their reason and a constraint snapshot
- [ ] The snapshot reflects mandate state at decision time, asserted by showing it differs from the mandate's later state
- [ ] Each row carries latency and the hold, order, payment and idempotency identifiers that exist at that step
- [ ] A decision written inside the booking transaction rolls back with it
- [ ] Trace endpoint returns a mandate's decisions in order
- [ ] Search and availability steps are not logged

## Blocked by

- #5

