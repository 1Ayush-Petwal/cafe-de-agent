# Owner manages the floor

> Local mirror of [1Ayush-Petwal/Project-1/issues/8](https://github.com/1Ayush-Petwal/Project-1/issues/8) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

The owner side, end-to-end. The owner role and its guards land in this slice (auth is not a separate layer-issue): owner-role JWT, owner-only endpoints scoped to cafés the owner owns. An owner manages their floor — tables with capacity, the daily slot grid (opening hours, turn time) — views a day's bookings, and can take a table out of service.

## Acceptance criteria

- [ ] An owner can log in and reach the owner dashboard; customers cannot
- [ ] An owner can create/edit tables (capacity) and define the daily slot grid for their own café only; attempts against another owner's café are rejected
- [ ] An owner can view all bookings for a chosen day
- [ ] An owner can take a table out of service; it immediately stops being bookable and shows unavailable

## Blocked by

- #2
