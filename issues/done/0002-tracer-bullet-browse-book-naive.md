# Tracer bullet: browse → book (naive)

> Local mirror of [1Ayush-Petwal/Project-1/issues/2](https://github.com/1Ayush-Petwal/Project-1/issues/2) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

The thinnest complete path through the whole system: a customer signs up, logs in, browses seeded Delhi cafés, views a café's slot availability grid for a date, books a table, and can see and cancel the reservation under "my reservations".

Scope pulled in only as far as this path needs it: minimal schema for User/Cafe/Table/Slot/Reservation, a synthetic Delhi seed (60-minute slots, 09:00–22:00), just-enough JWT auth (customer role only — the owner role arrives with the owner slice), the React screens for the path, and the house test pattern (API-level tests over HTTP against real Postgres in a container).

Booking is naive check-then-insert **on purpose** (PRD / Roadmap M0): the double-booking race is the setup for the next slice. Do not fix it here.

## Acceptance criteria

- [ ] Seed script creates synthetic Delhi cafés with tables and a 60-minute slot grid (09:00–22:00)
- [ ] A customer can sign up, log in (JWT), browse cafés, and view a café's availability for a date in the UI
- [ ] A logged-in customer can book a free table+slot; it appears in "my reservations" and the slot shows unavailable to others
- [ ] Cancelling a reservation frees the slot
- [ ] A customer cannot view or cancel another customer's reservations
- [ ] API-level tests run over HTTP against real Postgres (containerized), no mocked datastore; booking is intentionally naive check-then-insert

## Blocked by

None - can start immediately
