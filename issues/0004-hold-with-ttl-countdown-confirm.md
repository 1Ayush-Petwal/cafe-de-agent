# Hold with TTL countdown → confirm

> Local mirror of [1Ayush-Petwal/Project-1/issues/4](https://github.com/1Ayush-Petwal/Project-1/issues/4) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Split booking into hold → confirm per the reservation lifecycle (Roadmap M2). Starting checkout takes a Hold on the table+slot — a Redis TTL lock, not a long DB transaction — and the UI shows a countdown. Confirming within the TTL re-validates hold ownership atomically and writes the CONFIRMED reservation to Postgres. Abandoned holds auto-expire and release the slot.

The last-second race (hold expiring exactly as the user confirms) is a named requirement: confirm must never succeed against a hold that has expired and been re-held by someone else.

## Acceptance criteria

- [ ] Starting checkout creates a TTL hold and the UI shows a countdown
- [ ] A held slot is unavailable to other customers for the hold's lifetime
- [ ] Confirming within the TTL produces a CONFIRMED reservation and releases/converts the hold
- [ ] An expired hold auto-releases the slot with no manual cleanup
- [ ] The last-second race is closed: a confirm racing hold expiry either wins atomically or fails cleanly — covered by a test
- [ ] No long-lived DB transactions or pinned connections during checkout

## Blocked by

- #3
