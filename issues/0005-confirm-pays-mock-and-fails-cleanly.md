# Confirm pays (mock) and fails cleanly

> Local mirror of [1Ayush-Petwal/Project-1/issues/5](https://github.com/1Ayush-Petwal/Project-1/issues/5) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Add the mock payment step inside confirm. The mock gateway can be made to fail on command — that toggle is a product feature (the saga's pay step must be able to fail deterministically; the agent slices depend on it). A failed payment leaves no confirmed reservation, releases the hold, and shows the customer a clean, retryable failure.

## Acceptance criteria

- [ ] Confirm executes a mock payment; on success the reservation is CONFIRMED with a payment record
- [ ] The mock gateway's failure can be toggled on command
- [ ] A failed payment leaves no CONFIRMED reservation and releases the hold — test uses the toggle
- [ ] The customer sees a clear, retryable payment failure in the UI

## Blocked by

- #4
