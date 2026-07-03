# Agent happy path: NL request → approved booking

> Local mirror of [1Ayush-Petwal/Project-1/issues/9](https://github.com/1Ayush-Petwal/Project-1/issues/9) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

## Parent

#1 — PRD: Café Booking System

## What to build

The agent happy path (Roadmap M5, first half): a customer types a natural-language request into the agent chat; the request persists a workflow and enqueues a job, returning immediately. The worker drives the hand-rolled plan → tool → observe loop. Tools are authenticated calls to the app's own public API as the requesting customer (search, availability, hold, confirm) — no privileged backend access. Progress streams live into the chat over the SSE channel. Before anything that spends money, the workflow parks durably in AWAITING_APPROVAL (no blocked worker thread); the customer approves in the UI and the workflow resumes to a confirmed booking.

The LLM sits behind a thin client boundary; tests use a scripted fake provider. This slice forces the deferred provider choice — any hosted LLM with tool-use support, chosen against current provider docs.

## Acceptance criteria

- [ ] Submitting a natural-language request returns immediately with a workflow id; the loop runs on the worker, not in the HTTP request
- [ ] The agent completes an unambiguous booking end-to-end using authenticated public-API tool calls only
- [ ] Progress streams live into the chat UI over SSE
- [ ] The workflow parks durably in AWAITING_APPROVAL before spending; UI approval resumes it to a confirmed booking; the worker is never blocked while parked
- [ ] Tests drive the whole flow with a scripted fake LLM at the client boundary; no real LLM calls in tests
- [ ] An LLM provider is chosen and wired behind the client boundary using its current tool-use docs

## Decisions (resolved by owner, 2026-07-04)

- **LLM provider: Google Gemini.** Use model `gemini-2.0-flash` via the Gemini API's function-calling (tool-use) support, per its current docs.
- **API key:** read `GEMINI_API_KEY` from `apps/api/.env` (loaded via `@nestjs/config` like the other vars). The owner adds the real key; do not commit it. If the key is absent, the agent endpoint should fail with a clear error — tests never need it because they use the scripted fake provider at the client boundary.

## Blocked by (all done)

- #5
- #6
- #7
