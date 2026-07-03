# Cache-aside for search & availability

> Local mirror of [1Ayush-Petwal/Project-1/issues/13](https://github.com/1Ayush-Petwal/Project-1/issues/13) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Fast reads (Roadmap M6): café search and availability reads served cache-aside from Redis with TTL, invalidated by the same booking-state events that already feed the live grid (event-based invalidation is earned — the events exist). The cache is a hint, never booking truth: the write path always re-validates at booking time, so a stale cache entry can never cause a double booking.

## Acceptance criteria

- [ ] Café search and availability reads are served cache-aside from Redis with TTL
- [ ] A booking state change invalidates the affected cache entries via the existing events
- [ ] A deliberately stale cache entry cannot produce a double booking — write-time re-validation covered by a test

## Blocked by

- #7
