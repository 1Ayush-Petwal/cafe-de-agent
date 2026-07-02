# M7 design doc: scale to N regions (DESIGN only)

> Local mirror of [1Ayush-Petwal/Project-1/issues/14](https://github.com/1Ayush-Petwal/Project-1/issues/14) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

No code — the Roadmap M7 [DESIGN] deliverable: a design doc + diagram in the repo defending the next order of magnitude. Reads scale first via replicas plus a denormalized availability read model (CQRS) while the write path stays strict; region is the shard key (bookings rarely cross regions); the first service to split off the monolith is the agent worker, with the metric that triggers the split named.

## Acceptance criteria

- [ ] A design doc + diagram exists in the repo covering: read scaling (replicas + CQRS read model, write path stays strict), region sharding rationale and the cross-region tradeoff, and the first service split (agent worker) with its triggering metric
- [ ] Every claim maps to an M7 interview question in Roadmap.md and is defensible on a whiteboard

## Blocked by

- #10
- #13
