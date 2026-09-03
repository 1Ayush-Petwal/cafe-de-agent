# PRD: Café Booking System — region-scoped reservations with live availability + AI booking agent

> Local mirror of [1Ayush-Petwal/Project-1/issues/1](https://github.com/1Ayush-Petwal/Project-1/issues/1) — issue template per the local `to-issues` skill (`~/.claude1/skills/to-issues`). GitHub is the source of truth.

> **Canonical sources:** `Roadmap.md` (milestones M0–M7, locked decisions, per-milestone tradeoffs and interview questions) and `Idea.md` (vision). This PRD is the product-shaped cut of that truth — it references the Roadmap rather than duplicating it. Where they conflict, `Roadmap.md` wins.

## Problem Statement

Two problems, one primary:

1. **(Primary — the builder.)** A fresher targeting senior-level backend/system-design interviews has no defensible, first-hand tradeoff stories. Reading DDIA doesn't produce "here's the double-booking race I reproduced and the three ways I fixed it." The problem is the absence of a project where every architectural decision was *forced by a real failure* and can be defended on a whiteboard.
2. **(In-product — the users.)** Customers in one city can't reliably reserve a café table for a specific time: they don't know what's free right now, availability goes stale while they decide, and two people can grab the same table at once. Café owners have no way to expose their tables and slots or see their day's bookings. Customers who'd rather say "quiet table for 3 near Connaught Place this Saturday evening" than click through a grid have no way to delegate the booking.

The product problem exists to make the learning problem real: every product requirement below traces to either a user need or a named learning goal in `Roadmap.md`. Success criterion: **every decision in the concept map (Roadmap.md, final table) can be defended on a whiteboard.**

## Solution

A **region-scoped café table-reservation platform** (single seeded city: **Delhi**) with live availability and an **AI booking agent**, built as a **modular monolith + one worker process** on NestJS/TypeScript, Postgres (source of truth), Redis (holds/cache/pub-sub), and a React frontend.

From the customer's perspective: browse Delhi cafés → see a live availability grid for a date → **hold** a table+slot (short TTL, visible countdown) → **confirm** (mock payment) → get notified; cancel anytime; or skip all of it and tell the **agent** what you want in natural language, watch its progress stream, and approve before it spends money. From the owner's perspective: manage your café's tables and slot grid, and view the day's bookings.

Architecturally (the spine, locked): a **synchronous, transactionally-correct booking core** (concurrency arbitrated by Postgres) wrapped by an **asynchronous, failure-tolerant orchestration layer** (queue + worker) that runs notifications and the agent workflow. The agent is **just another authenticated client of the public API** — it can't do anything a human couldn't, so every correctness guarantee of the core holds under it.

**Personas:** Customer, Café owner. (The agent is a *client*, not a persona. The builder is the meta-persona whose success metric is interview-defensibility.)

## User Stories

**Discovery & availability**

1. As a customer, I want to browse cafés in my region, so that I can find somewhere to book.
2. As a customer, I want to filter cafés by party size and desired time, so that I only see cafés that can actually seat us.
3. As a customer, I want to see a café's slot-by-slot availability for a chosen date, so that I can pick a time that works.
4. As a customer, I want the availability grid to update live while I'm looking at it, so that I don't try to book a slot someone else just took.
5. As a customer, I want the grid to silently refresh after a connection drop, so that I'm never acting on stale data.

**Booking (hold → confirm)**

6. As a customer, I want to hold a table for a short window when I start checkout, so that nobody else can grab it while I decide.
7. As a customer, I want to see a countdown on my hold, so that I know how long I have to confirm.
8. As a customer, I want an abandoned hold to auto-release, so that tables aren't blocked by people who walked away.
9. As a customer, I want to confirm my hold into a reservation with a (mock) payment, so that my table is guaranteed.
10. As a customer, I want a clear, immediate error if someone else beat me to a slot, so that I can pick another instead of discovering a double-booking at the café.
11. As a customer, I want double-clicking "confirm" (or a flaky retry) to be safe, so that I'm never double-charged or double-booked.
12. As a customer, I want a confirmation notification after booking, so that I have a record.
13. As a customer, I want to view my upcoming and past reservations, so that I can keep track of my plans.
14. As a customer, I want to cancel a reservation, so that the table frees up for someone else.
15. As a customer, I want a booking to still succeed even if the notification system is down, so that a side-effect outage never costs me my table.

**AI booking agent**

16. As a customer, I want to describe my booking in natural language ("table for 4, Saturday 8pm, somewhere quiet"), so that the agent finds and books it for me.
17. As a customer, I want to watch the agent's step-by-step progress live, so that I trust what it's doing.
18. As a customer, I want the agent to pause and ask for my approval before any step that spends money, so that I stay in control.
19. As a customer, I want the agent to ask a follow-up question when my request is ambiguous, so that it doesn't guess wrong.
20. As a customer, I want an agent booking that fails midway to clean up after itself (release its holds), so that I'm not left with phantom holds.
21. As a customer, I want to close my laptop while the agent works and come back to it still running (or awaiting my approval), so that a dropped connection never kills my booking.
22. As a customer, I want the agent to be rate- and budget-limited, so that a runaway loop can't spam holds or burn money on my behalf.

**Auth & roles**

23. As a customer, I want to sign up and log in, so that my reservations belong to me.
24. As a customer, I want only myself to be able to view or cancel my reservations, so that my bookings are private and safe.
25. As a café owner, I want to log in with an owner role, so that I can manage my café and nothing else.

**Owner / admin**

26. As a café owner, I want to create and edit my café's tables (with capacity), so that the platform reflects my real floor.
27. As a café owner, I want to define my café's daily slot grid (opening hours, turn time), so that customers book times I actually serve.
28. As a café owner, I want to view all bookings for a given day, so that I can plan service.
29. As a café owner, I want to take a table out of service, so that customers can't book it while it's unavailable.

**The builder (learning goals — success is measured here)**

30. As the builder, I want a deliberately naive M0 booking path whose double-booking race I can reproduce with a failing concurrent test, so that every later fix is earned by a demonstrated failure.
31. As the builder, I want the race fixed three ways (unique constraint, pessimistic, optimistic) and compared under contention, so that I can defend when each fits.
32. As the builder, I want holds to live in Redis with TTL rather than long transactions, so that I own the distributed-locking story (including the last-second confirm race and the Redlock critique).
33. As the builder, I want side-effects committed via an outbox and processed by an idempotent worker with retries and a dead-letter queue, so that I own the at-least-once story.
34. As the builder, I want real-time delivery over SSE with a Redis pub/sub backplane across two API instances, so that I own the horizontal fan-out story.
35. As the builder, I want the agent hand-rolled as a durable saga with compensations and a human-in-the-loop pause, so that I own the durable-workflow story rather than hiding it in a framework.
36. As the builder, I want every non-functional requirement tagged BUILD or DESIGN, so that scale claims I can't test locally are made honestly on a whiteboard instead of faked.

## Implementation Decisions

Locked decisions live in `Roadmap.md` ("the spine" + per-milestone sections); do not relitigate. Summary + the decisions this PRD newly pins:

**Architecture & stack (locked)**
- Modular monolith + one worker process + **one** real distributed seam (the queue). No microservices; the service split is an M7 whiteboard exercise.
- NestJS + TypeScript for API and worker; Postgres = source of truth; Redis = holds/TTL, cache, pub/sub; React frontend. Single language, no Go.
- Concurrency is arbitrated **in Postgres**, not the app.

**Domain model & booking core**
- Entities: `User`, `Cafe`, `Table`, `Slot`, `Reservation`, plus a mock `Payment` and an agent `Workflow`. A reservation = `(table_id, slot_id)`.
- Slots are a **fixed, non-overlapping grid** — non-overlap is what makes `UNIQUE(table_id, slot_id)` a complete double-booking guard. Arbitrary intervals are a whiteboard-only answer.
- **Pinned here:** turn time = **60 minutes**, grid 09:00–22:00 per café, as seed-script configuration (trivially changeable; realism is not the point).
- **Pinned here:** seed region = **Delhi**, fully synthetic seed data (no scraping).
- Reservation lifecycle (from `Idea.md`, encodes the state decision precisely):

  ```
  AVAILABLE → HELD (TTL) → CONFIRMED → COMPLETED
                  │             │
                  └─ expires ─► AVAILABLE
                                └──► CANCELLED
  ```

- M1 builds **all three** locking strategies (unique constraint / `FOR UPDATE` / optimistic version) for comparison; the unique constraint remains in the schema permanently as the backstop.
- Holds (M2) = Redis `SET NX EX`; confirm must re-validate hold ownership **atomically** (the last-second-expiry race is a named requirement, not an edge case to discover).

**Async spine**
- Queue (M3) = Postgres `SELECT … FOR UPDATE SKIP LOCKED`; booking commit + enqueue are atomic via the **transactional outbox**. Consumers are idempotent; failed jobs retry then dead-letter. BullMQ graduation is DESIGN-only until a named metric forces it.
- Real-time (M4) = **SSE only**, no WebSockets anywhere. Redis pub/sub is the cross-instance backplane. Missed events are not replayed — clients refetch on reconnect (replay is DESIGN).

**AI agent (M5)**
- A durable async workflow: request creates a persisted workflow row + queue job; the worker drives the plan→tool→observe loop; progress streams to the client over the M4 channel.
- Tools = **authenticated calls to the app's own public API** (search, check availability, hold, confirm, cancel). No privileged backend access.
- hold→confirm→pay is a **saga** with compensating actions (failed confirm releases the hold). Human-in-the-loop: workflow parks in `AWAITING_APPROVAL` before spending; the worker never blocks on it.
- Guardrails: per-user rate limit + per-session hold/cost budget.
- The loop is **hand-rolled**; a LangGraph reimplementation is an optional A/B comparison only — never a runtime fallback, first thing cut under time pressure.
- **Agent scope pinned:** natural-language booking (incl. clarifying follow-ups) is core. Concierge/recommendations and owner-side automation are **out** (stretch beyond this PRD).
- **LLM provider: deferred to implementation.** Requirement is only "hosted LLM with tool-use/function-calling support," accessed through a single thin client boundary (which is also the test seam) so the provider is swappable. Choose against *current* provider docs at build time, not from memory.

**Auth (pinned minimal RBAC surface)**
- JWT access tokens, two roles: `customer`, `owner`. No refresh rotation, no fine-grained permissions.
- Entire RBAC surface: owner-role guard on café-management endpoints, scoped to cafés the owner owns; customers can only read/cancel their own reservations; the agent authenticates as the requesting customer.

**Scale hardening (M6)**
- Cache-aside in Redis for search/availability reads, invalidated by the same events that feed SSE. Cached availability is a *hint*; booking truth is always re-validated at write time (M1/M2 gates).
- Token-bucket rate limiting per user/IP. `Idempotency-Key` header on confirm; retries return the stored result.

**Payments**
- Mock gateway only. It exists so the saga's pay step can **fail on command** — a controllable failure toggle is a product requirement, not a test convenience.

**Frontend ("polished" pinned as exactly these screens)**
1. Login/signup. 2. Café list + search/filters. 3. **Live availability grid** (SSE-driven — the backend's real-time story made visible). 4. Booking flow: hold with TTL countdown → confirm → result. 5. My reservations + cancel. 6. **Agent chat with live progress stream + approval button**. 7. Minimal owner dashboard: tables/slots CRUD + day's bookings.
Screens 3 and 6 are the ones that earn their keep; nothing beyond this list counts toward "done."

## Testing Decisions

- **A good test exercises external behavior at the highest seam and asserts observable outcomes** (HTTP responses, resulting state readable via the API, events received by a real client) — never internal calls or implementation details.
- **Primary (and near-only) seam: the public HTTP API**, exercised against **real Postgres and Redis** in local containers. The datastores are never faked, because their concurrency semantics (row locks, unique violations, TTL expiry) are the very subject under test. The worker runs in-process during tests.
- **Two auxiliary seams, both already forced by the design:** (1) the **LLM client boundary** — a fake provider returning scripted tool-call sequences (deterministic, free, offline); (2) the **mock payment gateway's failure toggle** — a product feature reused to trigger saga compensation on demand.
- Milestone-defining tests (each reproduces the failure that justifies the milestone, per the Roadmap's earned-complexity rule):
  - M1: N parallel booking requests for one slot — **must demonstrate double-booking on the naive path**, then pass under each of the three locking fixes; plus a contention comparison.
  - M2: hold expiry releases the slot; the last-second confirm-vs-expiry race is closed.
  - M3: a duplicate job delivery has no double effect (idempotent consumer); a poisoned job dead-letters after N retries; a booking commit never loses its job (outbox).
  - M4: two API instances + one Redis — a booking on instance A reaches an `EventSource` client on instance B.
  - M5: pay-step failure releases the hold (compensation); a workflow resumes after a worker restart; `AWAITING_APPROVAL` parks and resumes without blocking the worker.
  - M6: duplicate `Idempotency-Key` returns the stored result; stale cache never wins over booking-time re-validation.
- **Prior art:** none — greenfield. The M1 concurrent test is written first and establishes the house pattern (supertest-style HTTP calls, real containers, assertions via the API).

## Out of Scope

- Real payment integration (mock only).
- Microservices / service extraction (M7 whiteboard design only).
- WebSockets, anywhere.
- Multi-region **implementation** — sharding, replicas, CQRS are M7 DESIGN deliverables (a design doc + diagram), not code.
- Arbitrary-interval reservations (`tstzrange` + exclusion constraints) — whiteboard answer only.
- Fine-grained RBAC, refresh-token rotation, OAuth/social login.
- Agent concierge/recommendations and owner-side AI automation.
- LangGraph as a runtime dependency (optional A/B writeup only; first cut under time pressure).
- SSE event replay for disconnected clients (clients refetch; replay is DESIGN).
- Mobile apps; real/scraped café data; load-testing at the 100k-user target (that scale lives in DESIGN-tagged claims).

## Further Notes

**Module → milestone map** (functional detail lives in `Roadmap.md`; don't duplicate it):

| Module | Milestone |
|---|---|
| Domain model, schema, seed, naive booking, auth stub | M0 |
| Booking engine correctness (3 locking strategies) | M1 |
| HELD state + TTL holds | M2 |
| Queue + worker + outbox + notifications | M3 |
| Real-time availability (SSE + backplane) | M4 |
| AI agent (durable workflow + saga + HITL) + mock payments | M5 |
| Caching, rate limiting, idempotency keys | M6 |
| Scale to N regions/N× load | M7 (DESIGN only) |

**Non-functional requirements**, tagged per the Roadmap's BUILD/DESIGN convention:
- No double-booking under arbitrary request concurrency — **[BUILD]** (proven by the M1 test).
- No lost booking side-effects across worker crashes/retries — **[BUILD]**.
- Live availability delivered across ≥2 API instances — **[BUILD]**.
- Agent workflows survive worker restarts and client disconnects — **[BUILD]**.
- Abuse/runaway protection (rate limits, budgets, idempotency) — **[BUILD]**.
- Hundreds → hundreds of thousands of users; regional sharding; read scaling — **[DESIGN]** (M7 doc; claimed on a whiteboard, honestly, not load-tested).

**Success metrics:** the per-milestone "interview questions you should own" lists in `Roadmap.md` — the project is done when each can be answered from first-hand build experience, and the M7 design doc exists. No product KPIs; this is a portfolio project and pretending otherwise would be noise.

**Sequencing:** implementation starts at M0+M1 (schema, seed, the failing concurrent test, the three fixes) — the natural first plan after this PRD.
