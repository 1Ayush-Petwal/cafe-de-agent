# Double-booking race: reproduce it, then fix it three ways

> Local mirror of [1Ayush-Petwal/Project-1/issues/3](https://github.com/1Ayush-Petwal/Project-1/issues/3) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Reproduce the double-booking race in the naive booking path, then make check-and-reserve atomic three ways and compare them (Roadmap M1 — the crown jewel).

First, a concurrent test fires N parallel booking requests at one table+slot and demonstrates that the naive path double-books. Then fix it three switchable ways: unique constraint on (table, slot) with the violation handled; pessimistic SELECT FOR UPDATE; optimistic version column with retry. Measure behavior and throughput under rising contention and record the comparison. The losing customer sees an immediate, clear "slot already taken" error in the UI.

## Acceptance criteria

- [ ] A concurrent test (N parallel HTTP booking requests for one table+slot) reproduces the double-booking against the naive path before any fix exists
- [ ] All three strategies are implemented and selectable for comparison: unique constraint, pessimistic lock, optimistic versioning
- [ ] The same concurrent test passes under each strategy: exactly one booking wins
- [ ] The unique constraint on (table, slot) stays in the schema permanently as the backstop
- [ ] A contention comparison (behavior and throughput as parallelism rises) is recorded in the repo
- [ ] The losing customer gets an immediate, clear "slot taken" error in the UI

## Blocked by

- #2
