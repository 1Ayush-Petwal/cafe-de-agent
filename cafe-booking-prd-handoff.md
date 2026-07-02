# Handoff — Café Booking System (next session: write the PRD)

**Date:** 2026-07-02
**Next session's job:** Turn the refined requirements below into a **Product Requirements Document (PRD)**. The design/architecture debate is *done*; do not reopen settled decisions (see "Do not relitigate"). Your task is to structure what's decided into a proper PRD.

---

## Canonical artifacts — read these first, treat as source of truth

Everything about *what to build and why* already lives in the repo. **Do not re-derive or duplicate these — build the PRD on top of them.**

- **`/Users/ayushpetwal/Desktop/Cafe-De-App/Roadmap.md`** — the authoritative record. Contains: the locked decisions ("the spine"), the 8-milestone learning roadmap (M0–M7), each milestone's earned problem / topics / tradeoffs / interview questions / resources, the BUILD-vs-DESIGN convention, and the concept-coverage map. **This is your primary input.**
- **`/Users/ayushpetwal/Desktop/Cafe-De-App/Idea.md`** — the original vision doc. Its §10 is an open-questions checklist; most items are now resolved (see "Still open" below for what remains).

---

## One-paragraph context

A **region-scoped café table-reservation platform** (fixed time-slots) with live availability and an **AI booking agent**. It's a **learning/portfolio project for a fresher** whose explicit goal is *not* a polished product but **talking points defensible in a senior-level system-design interview** — where the act of building teaches each tradeoff. The architecture spine: **a synchronous, transactionally-correct booking core wrapped by an asynchronous, failure-tolerant orchestration layer** (queue + worker). Stack: **NestJS + TypeScript** (API + worker), **Postgres** (truth), **Redis** (holds/TTL, cache, pub/sub), **React** frontend (mandatory).

---

## What the PRD should contain (tailored)

The Roadmap is *engineering-milestone* shaped. The PRD is *product-requirement* shaped — a different cut of the same truth. Suggested sections:

1. **Product summary & goals** — including the unusual primary goal (interview-defensibility) and the success criterion ("can defend on a whiteboard").
2. **Personas** — Customer, Café owner/admin. (Agent is a *client*, not a persona.)
3. **User flows** — discover → check availability → hold (TTL) → confirm; cancel; owner manages tables/slots/capacity; agent-driven NL booking.
4. **Functional requirements per module** — Discovery/search, Booking engine, Real-time availability, Auth/roles, AI agent, (mock) Payments. Map each to its milestone in Roadmap.md rather than re-explaining the engineering.
5. **Non-functional requirements** — correctness under concurrency (no double-booking), the scale target ("hundreds → hundreds of thousands"), but **tag each NFR BUILD vs DESIGN** per the Roadmap convention (you can't load-test 100k; some NFRs are whiteboard-only).
6. **Out of scope / explicit non-goals** — real payments, microservices, WebSockets, multi-region implementation, heavy RBAC, mobile.
7. **Success metrics** — framed as "interview questions I can answer" (the Roadmap already lists these per milestone; reference, don't copy).

Keep the PRD lean — **ponytail mode is active this project** (laziest-thing-that-works; no speculative sections, no requirement that doesn't trace to a real user need or a named learning goal).

---

## Decisions locked (canonical list is in Roadmap.md — this is orientation only)

- Goal = whiteboard-defensible tradeoffs; build teaches them.
- Agent = **durable async workflow**, never a sync client. Tools = authenticated calls to the app's own public API (no privileged backend access).
- Deployment = **modular monolith + worker + one queue seam**. No microservices (service-split is a whiteboard-only exercise, M7).
- Stack = NestJS + TS, single language, React frontend. **No Go.**
- Booking unit = **fixed turn-time slots**; `reservation = (table_id, slot_id)`. Arbitrary intervals = whiteboard-only.
- Concurrency lives in **Postgres**, not the app (Node is single-threaded).
- Queue (M3) = Postgres `SELECT … FOR UPDATE SKIP LOCKED` first → BullMQ when a named metric forces it.
- Real-time (M4) = **SSE, no WebSockets anywhere**. Redis pub/sub backplane is the actual distributed lesson.
- Payments (M5) = **mock only** (exists so the saga's pay-step can fail on command).
- Agent impl (M5) = **hand-rolled is real**; LangGraph is an optional **A/B comparison, not a runtime fallback**, first thing cut under time pressure.
- Locking (M1) = build **all three** (unique-constraint / pessimistic `FOR UPDATE` / optimistic `version`) to compare.

---

## Still open — the PRD should pin these (or flag as deferred)

- **Concrete region/city** for the seed dataset (decided: *synthetic seed, one region*; the specific city is unchosen — pick one for realism).
- **Slot turn-time length** (e.g. 60/90/120 min) and daily slot grid.
- **Agent scope** precisely: NL booking is core; concierge/recommendations + owner-side automation are Idea.md stretch — PRD should say in/out.
- **LLM provider** (unchosen). Use *current* provider docs, not memory — invoke the `claude-api` skill if using Claude.
- **"Polished frontend" definition** — the user said frontend is mandatory/polished; PRD should scope what screens count as done (availability grid + agent progress stream are the ones that earn their keep).
- **Auth specifics** — decided: JWT + two roles, stub-level; PRD should state the minimal RBAC surface.

---

## User context / working style

- Fresher targeting senior-level backend/system-design interview readiness. Strong in **TypeScript**.
- Moves fast, accepts well-argued recommendations, but *does* push back — expects reasoning, not deference. Values interview-defensibility over feature completeness.
- Corrected the AI agent from a "thin veneer" to a **deeply-integrated async workflow** — cares that every component teaches a real distributed-systems tradeoff.
- Prefers depth over breadth; explicitly wary of unnecessary complexity.

---

## Do not relitigate (settled — reopening these wastes the user's time)

Microservices vs monolith · Go vs NestJS · WebSockets vs SSE · fixed-slots vs intervals · agent-as-async-workflow · real-payments. All decided with reasons captured in Roadmap.md.

---

## Suggested skills for the next session

- **`domain-modeling`** — formalize the entities (`User`, `Cafe`, `Table`, `Slot`, `Reservation`, `Payment`) and a ubiquitous language; a PRD needs a crisp domain section and this gives it rigor.
- **`superpowers:brainstorming`** — *only if* you hit a genuine gap while writing (e.g. the "still open" items feel unresolved). The requirements are largely refined already, so this is a light touch, not a restart.
- **`superpowers:writing-plans`** — not for the PRD itself, but it's the right skill for the session *after* this one (turning the PRD into an implementation plan, starting with M0+M1).
- **`claude-api`** — if/when the LLM provider is chosen as Claude, for current model IDs and tool-use/function-calling APIs.
- Note: **ponytail mode is active** (session hook) — keep the PRD minimal; cut any requirement that doesn't trace to a user need or a named learning goal.

---

## Immediate next step

Read `Roadmap.md` fully, then draft the PRD per the section list above. The natural first deep-dive (per the last message of the prior session) is **M0 + M1** — the schema, the concurrent test that reproduces double-booking, and the three locking fixes — but the PRD should cover the whole product, not just those.
