# Café Booking System — Learning Roadmap

> Companion to `Idea.md`. This document turns the vision into a **milestone sequence where every step is triggered by a concrete failure of the step before it.** Nothing is added for coverage; each piece of complexity is *earned* by a real problem that appears when you go from hundreds to hundreds of thousands of users.

## Locked decisions (the spine)

- **Goal:** talking points I can *defend on a whiteboard*. The build is the teacher for the tradeoff, not a demo.
- **Architecture spine:** a **synchronous, transactionally-correct booking core** wrapped by an **asynchronous, failure-tolerant orchestration layer**. Core = the hard *synchronous* story (locking). Agent + notifications = the hard *asynchronous* story (queues, sagas).
- **Deployment shape:** modular monolith + one worker process + **one** real distributed seam (the queue). No microservices — the service split is a *design-only* talking point.
- **Stack:** NestJS + TypeScript (API and worker, same language), Postgres (source of truth), Redis (ephemeral state + cache + pub/sub), React frontend. No second runtime.
- **Booking unit:** fixed turn-time slots. A reservation = `(table_id, slot_id)`. Arbitrary intervals (`tstzrange` + exclusion constraint) are a whiteboard answer, not built.
- **Concurrency lives in the database, not the app.** Node is single-threaded; the real race is *two HTTP requests on two DB connections*, arbitrated by Postgres.

## Convention: BUILD vs DESIGN

You will never have 100k real users to test against. So each milestone is tagged:

- **[BUILD]** — implement it and prove it locally (a concurrent test, a load script, a chaos toggle).
- **[DESIGN]** — a written design + diagram you can whiteboard, *not* built. This is where "scale to N" lives honestly.

---

## M0 — Baseline: domain model, schema, naive booking  [BUILD]

**Why this exists:** you need a working, *deliberately naive* baseline before you can break it. The naivety is the setup for M1.

**Problem being solved:** none yet — this is the "what a junior would ship" version.

**System-design topics:** schema design & normalization; **the composite index** (`(cafe_id, slot_time)` — and *why the column order matters*); REST resource modeling.

**Build:**
- NestJS app, Postgres, entities: `User`, `Cafe`, `Table`, `Slot`, `Reservation`.
- Seed **one region** synthetically (a script — don't scrape; realistic fake data is enough).
- Endpoints: list cafés, list availability for a café/date, `POST /book`.
- Auth **stub**: JWT, two roles (customer, owner). No refresh rotation, no fine-grained RBAC.
- **Booking is naive on purpose:** `SELECT count where slot taken; if 0 then INSERT`. This read-then-write is a TOCTOU race — M1 breaks it live.

**Tradeoffs / why simpler breaks down:** the naive check-then-insert reads fine single-user and *silently corrupts* under concurrency. That gap is the entire point of M1.

**Interview questions you should own after this:**
- Why this normalization? What would denormalizing buy and cost?
- Why `(cafe_id, slot_time)` and not `(slot_time, cafe_id)`? What queries does each serve?
- JWT vs server sessions — what did you give up by choosing JWT?

**Resources before building:** *Use The Index, Luke!* (indexing, composite-index column order); any solid REST-design primer.

---

## M1 — The double-booking race (the crown jewel)  [BUILD]

**Why the architecture evolves:** M0's check-then-insert has a Time-Of-Check-To-Time-Of-Use race. Two concurrent requests both pass the "is it free?" check, both insert → **double booking.** You must make check-and-reserve *atomic*.

**Problem being solved:** correctness under concurrency.

**System-design topics:** transactions & ACID; isolation levels; **pessimistic vs optimistic vs unique-constraint** locking.

**Build:**
1. **Reproduce the bug first.** Write a test that fires N parallel requests at one slot and asserts the double-book happens. (This is your reflex-proof that the problem is real.)
2. Fix it **three ways** and compare under contention:
   - **Unique constraint** `UNIQUE(table_id, slot_id)` + catch the violation. Race becomes an error.
   - **Pessimistic** `SELECT … FOR UPDATE` on the slot row → the second request waits.
   - **Optimistic** `version` column → both proceed, loser rejected at commit, retry.
3. Measure: throughput and behavior of each as contention rises.

**Tradeoffs / why simpler breaks down:**
- Unique-constraint: simplest, correct — but only for *exact-match* uniqueness (dies for intervals), and turns races into errors you must handle.
- Pessimistic: correct, easy to reason about — serializes, lock-waits stack up under contention, deadlock risk.
- Optimistic: highest throughput when contention is low — wasted work + retry storms when contention is high.

**Interview questions you should own after this:**
- Walk me through read-committed vs repeatable-read vs serializable. What anomaly does each stop?
- What is `SELECT FOR UPDATE` actually doing at the row/lock level?
- When does optimistic beat pessimistic, and when does it collapse?
- How do deadlocks happen here and how would you detect/avoid them?

**Resources:** Postgres transaction-isolation docs; **DDIA ch.7 (Transactions)**.

---

## M2 — HELD state + TTL holds (soft locks without long transactions)  [BUILD]

**Why the architecture evolves:** real checkout takes 30s–2min (the user deliberates; later, the *agent* deliberates). You **cannot** hold a `SELECT FOR UPDATE` transaction open that long — it pins a DB connection and blocks everyone. You need a lock that (a) survives across HTTP requests and (b) **auto-expires** if abandoned.

**Problem being solved:** long-lived reservations without long-lived DB locks; abandoned-cart cleanup.

**System-design topics:** Redis as a distributed lock / ephemeral store; **TTL/expiry**; the HELD state machine (State pattern); reconciling a fast ephemeral store with the source of truth.

**Build:**
- Hold = `SET hold:{tableId}:{slotId} {userId} NX EX {ttl}` in Redis. `NX` gives you the lock atomically; `EX` gives you auto-release.
- Confirm within TTL → transactional write of `CONFIRMED` to Postgres + release/convert the hold.
- **The nasty edge:** the last-second race — the hold is expiring exactly as the user confirms. Confirm must *re-validate the hold ownership atomically* (check-and-delete via a Lua script or a compare token), or you'll confirm a hold that already expired and got re-held by someone else.

**Tradeoffs / why simpler breaks down:**
- DB-only holds (a `held_until` column + a background sweeper): one datastore, transactional — but holds now compete with real queries and you must build the sweeper.
- Redis `SET NX EX`: fast, self-expiring — but now you have **two sources of truth** and must handle divergence (Redis says held, but the Postgres confirm write fails — who wins?).

**Interview questions you should own after this:**
- Implement a distributed lock. Now tell me why **Redlock** is controversial (Kleppmann vs Antirez).
- What happens if the process holding the lock dies? What are **fencing tokens** for?
- Walk me through your last-second-confirm race and how you closed it.

**Resources:** Redis distributed-locks docs; **Martin Kleppmann, "How to do distributed locking."**

---

## M3 — Sync request → async job: the queue + worker  [BUILD]

**Why the architecture evolves:** confirming a booking has *side-effects* that are slow and can fail — sending a notification now, running the agent later. A failed email must **not** fail the booking, and you can't make the user wait on it. You must **commit the booking synchronously and enqueue the side-effects.** This is where the async spine is born.

**Problem being solved:** slow/unreliable side-effects on the critical path; making side-effects reliable (retries) without coupling them to the request.

**System-design topics:** job queue + background worker; **at-least-once delivery**; **idempotency**; retries + **dead-letter queue**; the **transactional outbox**.

**Build:**
- Add the worker process + a queue. On `CONFIRMED`, enqueue a `notify` job.
- Worker consumes, retries on failure, dead-letters after N attempts. Consumer is **idempotent** (dedupe on a job key) — because at-least-once means it *will* sometimes deliver twice.
- Close the dual-write gap: booking commit + enqueue must be atomic, or you'll commit a booking and lose its job. That's the **outbox pattern**.

**Queue-tech recommendation (contestable):** start with **Postgres `SELECT … FOR UPDATE SKIP LOCKED`** as the queue. Three reasons: it reuses the DB you already run; `SKIP LOCKED` is the *sibling* of the `FOR UPDATE` from M1 (same primitive, one clause different — a clean narrative callback); and transactional enqueue gives you the outbox for free. **Then, as a [DESIGN] step**, describe graduating to **BullMQ (Redis)** when you need delayed jobs / priorities / higher throughput — and name the metric that would force the move. "Started simple, measured, upgraded when X" is the senior story.

**Tradeoffs / why simpler breaks down:**
- Doing side-effects inline: booking latency now includes email latency, and an email outage takes down bookings.
- DB-as-queue vs Redis/BullMQ vs Kafka: DB-queue is simplest + transactional but polls and won't do millions/sec; BullMQ is purpose-built but still needs idempotency; **Kafka is the thing you'd name for replay/ordering/throughput at a scale you don't have** — say why you didn't.

**Interview questions you should own after this:**
- At-least-once vs at-most-once vs exactly-once — why is exactly-once a myth, and how does idempotency fake it?
- What's the dual-write problem and how does the outbox solve it?
- What's a DLQ for, and what do you do with what lands in it?
- When would you reach for Kafka over a simple queue?

**Resources:** **DDIA ch.11 (Stream Processing)**; the **transactional outbox** pattern (microservices.io); Postgres `SKIP LOCKED` docs.

---

## M4 — Real-time availability: SSE + pub/sub fan-out  [BUILD, thin]

**Why the architecture evolves:** when one user holds/books a slot, everyone else viewing that café must see it disappear *now*. Polling every 2s is laggy and wasteful (N users × cafés = wasted queries). And once you run **more than one API instance**, a change committed on instance A must reach a client connected to instance B.

**Problem being solved:** pushing state changes to many clients; **cross-instance fan-out** (the real distributed twist).

**Decision — SSE, not WebSockets.** Every push in this system is server→client: availability changes (M4) and agent progress (M5) both flow one way. The only client→server actions (book, cancel, agent follow-ups) are plain REST POSTs. Nothing is genuinely bidirectional, so WebSockets buy only a handshake and a hand-rolled reconnection story. **No WebSockets anywhere in the project.**

**System-design topics:** SSE vs WebSockets vs polling; **Redis pub/sub as a backplane** across API instances (protocol-agnostic — this lesson is identical whether the transport is SSE or WS); optimistic UI.

**Build:**
- NestJS SSE endpoint (`text/event-stream`). On any booking state change, publish to Redis channel `cafe:{id}`; every API instance is subscribed and re-emits to its *local* SSE clients. **The backplane is the real distributed lesson — and it survives the SSE choice untouched.**
- Frontend: a live-updating availability grid via `EventSource` (this is where the **mandatory React frontend earns its keep** — it visibly demonstrates the backend's real-time story).

**Tradeoffs / why simpler breaks down:**
- Polling: trivial, but laggy and O(users) wasted queries.
- WebSockets: bidirectional and heavier — its own handshake, and reconnection you build yourself. Justified only if something were genuinely client→server-streaming. Nothing here is.
- **SSE wins here:** plain HTTP, and `EventSource` **auto-reconnects and resumes via `Last-Event-Id` for free** — a *better* reconnection story than raw WS at zero cost. Gotcha to own: over HTTP/1.1 browsers cap ~6 connections per domain → serve over **HTTP/2**.
- **Disconnected clients:** you don't replay missed events — on reconnect the client refetches availability. Honest scoping; event-replay is **[DESIGN]**, not built.

**Interview questions you should own after this:**
- SSE vs WebSockets vs polling — pick one and defend it. When would you *actually* need WS?
- How do you scale a push channel horizontally? What is the Redis pub/sub backplane doing, and why is it the same for SSE and WS?
- What does `EventSource` give you for free on reconnect, and what's the HTTP/1.1 connection-limit gotcha?
- What happens to events while a client is disconnected? (Answer: dropped — client refetches — and why that's fine here.)

**Resources:** SSE-vs-WebSocket write-ups; the WHATWG `EventSource` / `text/event-stream` spec; Redis pub/sub docs.

---

## M5 — The AI agent as a durable async workflow (the capstone)  [BUILD]

**Why the architecture evolves:** the agent loop (*plan → call tool → observe → retry → next step*) runs for many seconds across several LLM + tool calls, any of which can fail or duplicate. It **cannot** live in an HTTP request: the connection would hang for 30s, die if the client drops, and couldn't resume after a crash. It must be a **durable job on the M3 queue**, with persisted state so it can resume and retry. This is the async spine's payoff.

**Problem being solved:** long-running, multi-step, partially-failing orchestration with external (LLM + payment) calls; correctness of a multi-step action under failure.

**System-design topics:** durable workflow / state machine as persisted jobs; the **saga pattern + compensating actions**; **idempotency under agent retries**; **human-in-the-loop** (confirm before spending); rate-limiting the agent as a load/cost source.

**Build:**
- Agent request → create a `workflow` row (`PENDING`) + enqueue. The **worker** drives the loop; the request returns immediately with a workflow id (frontend streams progress via the M4 channel).
- Tools = **authenticated calls to your own public API** (`search`, `check`, `hold`, `confirm`). The agent gets **no privileged backend access** — this is the one part of `Idea.md` §6 that survives, and it's a strong point: *"the agent is just a client — so it can't do anything a user couldn't, and every guarantee from M1–M3 still holds under it."*
- Each tool call **idempotent** (reuse M2/M3 keys) — because the agent *will* retry.
- The **hold → confirm → pay** chain is a **saga**: if `confirm` fails after `hold` succeeded, a **compensating action** releases the hold. You can't 2-phase-commit across your DB + an LLM + a payment mock, so a saga is the *only* correct option — that's the "why simpler breaks down."
- **Human-in-the-loop:** the agent pauses at "confirm (spends money)" → workflow sits in `AWAITING_APPROVAL`; the worker does **not** block; the user clicks approve; the workflow resumes. Durable pause, not a held thread.
- **Guardrails:** rate-limit + a per-session cost/hold budget so the agent can't spam holds or burn money.

**Tradeoffs / why simpler breaks down:**
- Synchronous agent: breaks on the long connection, can't resume after a crash, can't retry cleanly.
- **Hand-rolled is the real M5** — you hand-roll the loop to *own* the durability, idempotency, and saga logic a framework hides. **Then, only after it works, an optional LangGraph reimplementation of the same loop as a deliberate A/B** (mirroring the three locking strategies in M1): "the framework gave me the graph + state persistence for free, but I had to fight it to place my idempotency keys and my human-in-the-loop pause." ⚠️ This is a **comparison, not a runtime fallback** — you never "fail over" from your loop to LangGraph; two orchestration engines swapping on error is pure complexity and a red-flag interview answer. Scope the LangGraph version just far enough to write the comparison; it is the **first thing cut** if the schedule tightens.
- Saga vs distributed transaction: you physically cannot 2PC across these systems — name that.

**Interview questions you should own after this:**
- What's a saga, and why here instead of a distributed transaction? What are compensating actions?
- How do you make a *retried* LLM tool-call idempotent?
- How does the workflow resume after the worker crashes mid-loop?
- How do you keep an agent from spamming holds or overspending?
- Why does the agent get no special backend access, and what does that buy you?

**Resources:** **saga pattern** (microservices.io); **durable execution** concepts (Temporal's docs are the best free explainer, even if you don't use it); your LLM provider's **function-calling / tool-use** docs — use *current* docs (for Claude, see the `claude-api` reference), not half-remembered APIs.

---

## M6 — Scale hardening: caching, rate limiting, idempotency keys  [BUILD, selective]

**Why the architecture evolves:** read-heavy endpoints (search, availability) now hammer Postgres, and the API needs protection from abuse and from **duplicate submissions** (the double-clicked "confirm," the agent's retry).

**Problem being solved:** read scalability; overload/abuse protection; duplicate-request safety.

**System-design topics:** **cache-aside** + invalidation; **rate limiting** (token bucket / sliding window); **idempotency keys**.

**Build:**
- Cache café/search results in Redis (cache-aside + TTL). Invalidate on write — and reconcile with M4: the same event that pushes the WS update **invalidates the cache** (event-based invalidation is now *earned*, because you already have the events).
- Rate-limit middleware (Redis token bucket, per-user/per-IP).
- `Idempotency-Key` header on `POST /confirm` → store the result keyed by it; a retry returns the stored result instead of re-executing. Protects against double-clicks *and* agent retries.

**Tradeoffs / why simpler breaks down:**
- Cache-aside vs write-through vs write-behind; TTL vs event-based invalidation.
- **Stale-availability trap:** the cache may say "free" when a hold exists. You resolve it by treating the cache as a *hint* and **re-validating at booking time** (M1/M2 are the real gate). Cache is never the source of booking truth — a great subtlety to volunteer.
- Token bucket vs leaky bucket vs fixed/sliding window.

**Interview questions you should own after this:**
- Cache-aside vs write-through; how do you invalidate?
- What's a cache stampede / thundering herd and how do you stop it (locking, jitter, request coalescing)?
- Token bucket vs sliding window — pick one for login vs for search.
- Where do idempotency keys live, how long do you keep them, and what do they key on?
- Why can availability never be trusted straight from cache?

**Resources:** caching-pattern write-ups; rate-limiting-algorithm articles; **Stripe's idempotency-keys** engineering post (the canonical reference).

---

## M7 — Scale to N regions / N× load  [DESIGN only]

**Why this exists:** you can't build 100k users, so this is where you **design and defend** the next moves without building them. This is the payoff of the modular monolith.

**Problem being solved:** horizontal scale; data partitioning; the service-split decision.

**System-design topics:** read replicas; **sharding/partitioning by region**; **CQRS** (split the availability *read model* from the write model); eventual consistency; where the monolith splits into services and *what forces it*.

**Deliverable (no code):** a design doc + diagram. Key defensible claims:
- **Reads scale first** via replicas + a denormalized availability read-model (CQRS): the write path (M1 locking) stays strict; the read path serves a fast projection.
- **Region is a natural shard key** — bookings rarely cross regions, so partitioning by region gives locality with minimal cross-shard queries.
- **First service to split off = the agent worker**, because it scales on a *different axis* (LLM cost/throughput, spiky) than the booking core (steady, DB-bound). Name the metric that triggers the split.

**Interview questions you should own after this:**
- How do you scale reads without weakening the booking guarantee? (replicas + read-model, keep the write path strict)
- What's your shard key and why? What breaks with a cross-region booking?
- What is CQRS and when is it *not* worth it?
- When would you split the monolith, and how would you decide which seam first?

**Resources:** **DDIA ch.5–6 (Replication, Partitioning)**; CQRS (Martin Fowler); "modular monolith → services" migration writing.

---

## The complete concept map (what you can defend, and where you earned it)

| Concept | Earned in |
|---|---|
| Schema, normalization, composite indexing | M0 |
| Transactions, ACID, isolation levels | M1 |
| Pessimistic / optimistic / constraint locking | M1 |
| Distributed locks, TTL, Redlock critique, fencing | M2 |
| Queues, workers, at-least-once, idempotency, DLQ, outbox | M3 |
| SSE vs WebSockets, pub/sub backplane, EventSource reconnect | M4 |
| Durable workflows, sagas, compensation, human-in-the-loop, hand-rolled-vs-framework agent | M5 |
| Caching, invalidation, stampede, rate limiting, idempotency keys | M6 |
| Replicas, sharding, CQRS, service-split, eventual consistency | M7 (design) |

Every row is a *decision you made and can defend the tradeoff of* — not a feature you used.
