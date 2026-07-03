# Double-click-safe confirm (Idempotency-Key)

> Local mirror of [1Ayush-Petwal/Project-1/issues/11](https://github.com/1Ayush-Petwal/Project-1/issues/11) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Double-click-safe confirm (Roadmap M6): confirm accepts an Idempotency-Key header; the result is stored keyed by it, and a retry with the same key returns the stored result instead of re-executing. Protects against double-clicked confirms and duplicated retries — exactly one reservation, exactly one charge. The frontend sends the key; the agent's confirm tool can reuse the same mechanism.

## Acceptance criteria

- [ ] Confirm accepts an Idempotency-Key; a retry with the same key returns the stored result and does not re-execute payment or booking — covered by a test
- [ ] Double-clicking confirm in the UI yields exactly one reservation and one charge
- [ ] Keys have a documented retention window and documented keying rules

## Blocked by

- #5
