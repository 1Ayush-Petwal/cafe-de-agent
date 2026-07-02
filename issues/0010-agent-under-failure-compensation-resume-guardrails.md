# Agent under failure: compensation, resume, guardrails

> Local mirror of [1Ayush-Petwal/Project-1/issues/10](https://github.com/1Ayush-Petwal/Project-1/issues/10) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

Make the agent workflow correct when things break (Roadmap M5, second half). The hold → confirm → pay chain is a saga: a pay failure after a successful hold triggers the compensating action (release the hold) and ends the workflow in a clean, visible failed state. A workflow resumes from persisted state after a worker crash without duplicating side effects; retried tool calls are idempotent (no duplicate holds, no double charges). Ambiguous requests produce a clarifying follow-up question using the same durable-pause machinery as approval. Guardrails cap the blast radius: a per-session hold/cost budget and per-user rate limiting on agent requests.

## Acceptance criteria

- [ ] A pay-step failure (via the mock gateway toggle) triggers compensation: the hold is released and the workflow ends in a clean failed state visible in the chat
- [ ] Killing the worker mid-workflow and restarting resumes the workflow from persisted state to completion, with no duplicated side effects — covered by a test
- [ ] Retried tool calls are idempotent: no duplicate holds, no double charges — covered by a test
- [ ] An ambiguous request makes the agent ask a follow-up question and park durably; the customer's answer resumes it
- [ ] The agent cannot exceed its per-session hold/cost budget, and agent requests are rate-limited per user

## Blocked by

- #9
