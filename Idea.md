# Café Booking System — Project Idea

> **Working title:** BrewBook *(placeholder — rename later)*
> **Status:** Idea stage. Specifications and detailed design come later; this document only fixes the *vision, scope, and concept-coverage* so the rest of the project has an anchor.

---

## 1. One-line pitch

A **region-scoped café table-reservation platform** with **real-time availability** and an **AI booking agent** that turns a natural-language request ("book me a quiet table for 3 near Connaught Place this Saturday evening") into a completed, confirmed reservation.

---

## 2. Why I'm building this (the interview-coverage rationale)

This is deliberately a *combination project*. One codebase, but it forces me into several domains at once, so that almost any fresher-round question maps to something I actually built and can defend:

- **LLD / OOP + concurrency** → the booking engine (entity modeling, SOLID, design patterns, and the double-booking problem).
- **Real-time networking** → live availability updates and notifications over WebSockets.
- **Database design** → schema, indexing, transactions, and locking (this is where the concurrency story becomes real).
- **Agentic AI / automation** → an AI layer that plans and executes bookings via tool calls.

The goal is not "a big app." The goal is that for every concept bucket, I have a concrete decision I made and can explain the *tradeoff* behind. See the coverage map in §7.

---

## 3. The core idea

Users pick a **region** (a city or a locality within it), browse cafés, see **live availability** for time slots, reserve a **table for a slot**, and get an instant confirmation. There are two sides to the system:

- **Customer side** — discover, book, manage/cancel reservations, get notified.
- **Café owner / admin side** — manage tables, slots, capacity, and view bookings.

**Why scope it to a region?** It keeps the dataset realistic and curated, makes geo/availability queries meaningful, and gives a believable product story instead of a generic CRUD clone. It also naturally sets up "how would this scale to more regions?" as a stretch discussion.

---

## 4. Primary modules

1. **Discovery & search** — find cafés by region, cuisine/vibe, party size, and slot availability.
2. **Booking engine** — the heart of the system; concurrency-critical (see §5).
3. **Real-time layer** — live availability changes and booking notifications.
4. **User & role management** — customers vs. café owners/admins; auth.
5. **AI agent layer** — natural-language booking and automation (see §6).

---

## 5. The booking engine (the crown jewel)

This is the single most interview-valuable part of the project. Treat it as the centerpiece.

**Booking unit:** a *table × time-slot*. A reservation locks one table for one time window. Double-booking = two users trying to grab the same table for the same (or overlapping) slot at the same time.

**Reservation lifecycle (State pattern):**

```
AVAILABLE → HELD (temporary, with TTL) → CONFIRMED → COMPLETED
                     │                         │
                     └──── expires ────► AVAILABLE
                                               └──► CANCELLED
```

- The **HELD** state is a short-lived lock created when a user starts checkout, with a **TTL** so abandoned carts auto-release the table. (This TTL/expiry mechanic is also a nice OS-timers and cache-eviction talking point.)

**The double-booking problem — the story to master:**

- **Pessimistic locking** — lock the row (`SELECT ... FOR UPDATE`) so the second user waits. Simple, correct, but reduces throughput under contention.
- **Optimistic locking** — version/timestamp column; let both proceed and reject the loser at commit. Higher throughput, but needs retry logic.
- Wrapped in a **DB transaction** so the check-and-reserve is atomic (this is where ACID stops being a definition and becomes something I implemented).

Being able to whiteboard both approaches and argue *when* each fits is one of the highest-yield things this whole project gives me.

---

## 6. The agentic layer (conceptual — to be refined later)

The key design insight (worth stating in interviews): **the AI agent is just another client of the booking API.** It doesn't get special backend access — it uses **tool / function calls** to do exactly what a human client does, orchestrated by an agent loop.

**Agent loop:**

```
understand request → plan steps → call tools → observe results → respond / next step
```

**Tools the agent can call** (these are the same operations the app exposes):
- `search_cafes(region, filters)`
- `check_availability(cafe, date, party_size)`
- `hold_table(table, slot)`
- `confirm_booking(hold_id)`
- `cancel_booking(booking_id)`

**Use cases to consider (pick a subset later):**
- **NL booking** — "table for 4, Saturday 8pm, somewhere quiet in South Delhi" → the agent searches, checks availability, holds, and confirms.
- **Concierge / recommendations** — suggests cafés based on stated vibe, budget, or past bookings.
- **Owner-side automation** — summarize the day's bookings, flag overbooking risk, suggest opening extra slots on high-demand evenings.

**Why this framing is strong:** it reuses the entire backend (no throwaway AI demo), it demonstrates real **tool-use / function-calling** and an **agent loop** rather than a single prompt, and it gives a clean answer to "how did you integrate AI into a real system?" The agent is orchestration; the booking correctness still lives in the engine from §5.

*(Deferred: which LLM, framework vs. hand-rolled loop, how much memory/context the agent keeps, and how to sandbox its actions. These are §10 open questions.)*

---

## 7. Concept coverage map

| Concept bucket | Where it shows up in this project |
|---|---|
| **OOP & SOLID** | Entity model: `User`, `Cafe`, `Table`, `Slot`, `Reservation`, `Payment`. All five SOLID principles by construction. |
| **Design patterns** | **State** (reservation lifecycle), **Strategy** (search ranking / pricing / payment method), **Factory** (create reservations, notifications), **Observer** (notify on booking events), **Singleton** (config / connection manager), **Command** (agent actions / cancellable operations). |
| **Concurrency (OS)** | Table holds & locks, TTL-based expiry (timers), thread-safe availability updates, optional producer–consumer notification queue. |
| **Database design** | Schema + normalization; **indexing** (e.g. composite index on `cafe_id + slot_time`); **transactions/ACID** for the reserve operation; **optimistic vs. pessimistic locking**. |
| **Networking** | REST APIs for core ops; **WebSockets** for live availability + notifications; HTTP methods/status codes; the "why WebSockets over polling" argument. |
| **AI / Agentic** | LLM **tool-use / function calling**, the agent loop, prompt/orchestration design, (optional) retrieval over café data. |
| **System design (stretch)** | Caching layer, rate limiting, **idempotent** booking, notification queue, "how to scale to N regions." |

The value is that most concepts appear in a place where I made a *decision*, not just used a feature.

---

## 8. Suggested tech stack (flexible — decide later)

- **Backend:** Java + Spring Boot *(strong LLD/OOP signal for interviews)* — or Node/NestJS or Python/FastAPI. The choice mainly changes how "OOP-forward" the story reads.
- **Database:** **PostgreSQL** (real transactions + row-level locking → ideal for the double-booking demo) plus **Redis** (table holds/TTL + caching). This combo lets me tell *both* the ACID-transaction story and the TTL-hold story with real infrastructure.
- **Real-time:** WebSockets (native, Socket.IO, or STOMP).
- **AI:** any LLM with function-calling support; agent loop hand-rolled or via a framework (decide later).
- **Frontend:** React, kept intentionally light — this is a backend-depth project, not a UI showcase.

---

## 9. Scope / phases

**MVP (prove the hard parts):**
- Café + table + slot data for one region.
- Core booking flow with the HELD→CONFIRMED lifecycle.
- Correct concurrency: two users can't book the same table+slot.
- Basic auth (customer + owner).

**V2:**
- Real-time availability + notifications over WebSockets.
- The AI agent doing NL booking via tool calls.
- Owner dashboard.

**Stretch:**
- Caching + rate limiting + idempotency keys.
- Notification queue for offline/failed deliveries.
- Multi-region scaling discussion (and maybe implementation).
- Owner-side AI automations.

---

## 10. To define later (open questions)

*Kept as an explicit checklist since the specs are intentionally deferred.*

- Which **region** (concrete city/locality) and where does the café dataset come from — real, scraped, or seeded/synthetic?
- Booking model precision: fixed slots (e.g. 6:00, 6:30…) vs. arbitrary start times with a duration?
- **Locking strategy** to lead with — pessimistic or optimistic (or support both to compare)?
- Auth approach — sessions vs. JWT; how much RBAC for owners?
- **Agent scope** — booking-only, or concierge + owner automation too?
- Which **LLM / agent framework**, and hand-rolled loop vs. framework?
- How to **sandbox / guardrail** the agent's actions (spending, spammy holds, confirmation before booking)?
- Payments — real integration, mock, or out of scope for v1?
- How much frontend is worth building vs. an API-first approach?

---

*Next step: turn §5 (booking engine) and §10 into a concrete spec — that's where the real design decisions get pinned down.*
