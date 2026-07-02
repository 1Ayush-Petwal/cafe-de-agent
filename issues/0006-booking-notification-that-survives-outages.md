# Booking notification that survives outages

> Local mirror of [1Ayush-Petwal/Project-1/issues/6](https://github.com/1Ayush-Petwal/Project-1/issues/6) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

A confirmed booking produces a notification the customer can see (mock channel — in-app list or equivalent; the delivery machinery is the real deliverable). This slice pulls in the async spine because the user-visible behavior needs it (Roadmap M3): a worker process consuming a Postgres SKIP LOCKED queue, booking commit + job enqueue made atomic via the transactional outbox, retries with a dead-letter queue, and an idempotent consumer (at-least-once delivery will duplicate).

The point of the slice: a notifier outage never fails or slows a booking, and no confirmed booking ever silently loses its notification.

## Acceptance criteria

- [ ] Confirming a booking enqueues the notify job atomically with the booking commit (outbox) — no lost jobs, covered by a test
- [ ] A separate worker process consumes the queue (Postgres SKIP LOCKED) and delivers the notification where the customer can see it
- [ ] Booking succeeds, at normal latency, while the notifier is failing; the job retries and dead-letters after N attempts
- [ ] Duplicate delivery of the same job has no double effect (idempotent consumer) — covered by a test

## Blocked by

- #4
