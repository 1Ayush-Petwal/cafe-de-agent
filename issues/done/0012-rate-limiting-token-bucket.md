# Rate limiting (token bucket)

> Local mirror of [1Ayush-Petwal/Project-1/issues/12](https://github.com/1Ayush-Petwal/Project-1/issues/12) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Abuse protection (Roadmap M6): Redis-backed token-bucket rate limiting per user and per IP on the public API. Requests over budget get 429 with a sensible retry signal. Limits apply across API instances and never affect booking correctness — a rate-limited request simply never reaches the booking path.

## Acceptance criteria

- [ ] Requests beyond the per-user / per-IP budget receive 429 — covered by a test
- [ ] Limits are configurable and normal browse/book flows stay comfortably under them
- [ ] The limiter is a Redis-backed token bucket and holds across multiple API instances

## Blocked by

- #2
