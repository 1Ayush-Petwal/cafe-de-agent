# Availability grid goes live (SSE + Redis backplane)

> Local mirror of [1Ayush-Petwal/Project-1/issues/7](https://github.com/1Ayush-Petwal/Project-1/issues/7) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

The availability grid updates live (Roadmap M4). Any booking state change (held, confirmed, cancelled, expired) is published to Redis pub/sub; every API instance re-emits to its locally connected SSE clients; the React grid subscribes via EventSource and updates without refresh. On reconnect the client refetches availability — missed events are not replayed (that is DESIGN-only).

Transport is SSE everywhere; no WebSockets. The Redis backplane is the real lesson: it must carry a change committed on one API instance to a client connected to another.

## Acceptance criteria

- [ ] While two customers view the same café, one holding/booking/cancelling a slot updates the other's grid without a refresh
- [ ] Cross-instance fan-out proven: a change committed on API instance A reaches an EventSource client connected to instance B via the Redis pub/sub backplane (two-instance test)
- [ ] Transport is SSE (text/event-stream); no WebSockets anywhere
- [ ] On reconnect the client refetches availability; missed events are not replayed

## Blocked by

- #4
