# PRD: Café De Agentic Layer - mandate-gated agentic commerce for perishable inventory

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/1](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/1) - GitHub is the source of truth. Slices: issues #2-#12. Label: `documentation`.

> **Source:** `docs/cafedeagenticlayer.md` (Razorpay AI Buildathon, Track 01 - AI Growth & Agentic Commerce), refined in a grilling session on 2026-09-03/04. Every decision below was agreed with the product owner in that session, including several that overrule the source document. Where they conflict, this PRD wins.

> **Build window:** 2026-09-04 to 2026-09-05, video recorded by 16:00 on 09-05. The source document assumed three days; one was spent on design. The scope below is the two-day cut.

## Problem Statement

Seven problems, one per work area. The first six are gaps between what the buildathon track requires and what the substrate (`substrate-v1`, commit `cd55182`, 2026-07-28) actually does.

1. **Every booking costs the same ₹25 (platform).** `Cafe`, `CafeTable` and `Slot` carry no price at all; `WALLET_CHARGE_AMOUNT` is a flat whole-rupee constant. A spend ceiling can never bind, a percentage discount is worth ₹5, and revenue-per-slot is a constant - so neither a spending mandate nor a revenue mechanic can be built on top of it.

2. **An agent's spending authority is a prompt instruction (customer).** The agent pauses at `AWAITING_APPROVAL` before spending, which is a per-action dialog, not a bound. There is no artifact recording what the human authorised, no ceiling the agent cannot talk itself past, and nothing that survives the conversation it was granted in.

3. **The audit trail only records successes (platform).** `notification_jobs` and `webhook_jobs` capture bookings that happened. Nothing records what an agent *asked* to do and was refused, or the constraint state at the instant of the refusal - so no decision can be replayed and explained after the fact.

4. **Money is play money (platform).** The wallet is a fake gateway. The track requires the money path to run on Razorpay test APIs, and the substrate has no payment provider seam to swap one in behind.

5. **A capacity-constrained slot that goes unsold is destroyed, and nothing tries to prevent it (owner).** There is no notion of a slot being hot or cold, no alternative offered when the requested slot is taken, and no mechanic that converts an about-to-perish slot into revenue. "Grow the merchant's revenue" is half the track title and is entirely unbuilt.

6. **Value is unprovable (platform).** There is no way to demonstrate that an agentic layer sells more inventory than exact-match booking, and no measurement of what the gate costs in legitimate bookings it wrongly refuses.

7. **The two-day clock is the binding constraint (delivery).** Two of the seven work areas cannot fit if any of the first five slips. The plan must degrade in a pre-agreed order rather than by whatever is unfinished at 16:00 on the second day.

## Solution

From the customer's perspective: you grant your booking agent a **standing mandate** - a signed artifact naming ₹600 per booking, ₹1,500 in total, at most 3 bookings, in Hauz Khas or GK-II, for slots this week. You then talk to the agent normally. Inside those bounds it books without asking again; a request that breaks them is refused with the specific reason and the constraint snapshot that caused it. You can see the remaining headroom at any time and revoke the mandate outright. Booking directly through the UI yourself is unaffected - a mandate bounds delegated authority, not your own money.

From the merchant's perspective: slots now carry real prices that vary by hour and day. When a customer's requested slot is unavailable, or when a slot inside their window is measurably cold, the agent proposes up to two alternatives with a bounded discount - never below the owner's floor, never on a slot that is already hot, and never an alternative the mandate would refuse. Every action lands in a decision log the merchant can read back.

From the platform's perspective: the check that enforces the mandate and the write that spends its budget are the same atomic statement, executed inside the transaction that already writes the reservation, the payment and the outbox rows. Money moves through Razorpay test mode behind a provider switch, with the signed webhook as the source of truth. A batch harness runs the same fixed synthetic demand through an exact-match arm and an agent arm, and reports fill rate, revenue, denials by reason, and the false-positive cost of the gate.

## User Stories

**A. Per-slot pricing in paise (platform)**

1. As the platform, I want every slot to carry an integer paise price derived from its café's price band and its hour and day, so that a spending ceiling, a percentage discount and a revenue metric all have a real number to operate on.
2. As the platform, I want all money in the system stored as integer paise, so that no rounding error can enter at the Razorpay boundary, which takes paise natively.
3. As a customer, I want the wallet charge to be the slot's actual price rather than a flat fee, so that what I am charged matches what I was quoted.
4. As a customer, I want the price shown on the slot before I pick it, so that spending is never a surprise.
5. As a café owner, I want a price band on my café that the seeded per-slot prices derive from, so that my cafe's price level is a single number I control.
6. As a café owner, I want a maximum-discount floor on my café, so that no automated mechanic can discount my slots below what I consider acceptable.

**B. Mandate and the policy gate (customer, platform)**

7. As a customer, I want to grant my agent a standing mandate with a per-booking ceiling, a total ceiling, a booking count, allowed localities and a validity window, so that its authority is bounded by something it cannot argue with.
8. As a customer, I want the mandate's constraints signed by the server at grant time, so that there is a non-repudiable record of exactly which bounds I agreed to.
9. As a customer, I want to revoke a mandate at any time and have every subsequent action under it refused, so that I can withdraw delegated authority immediately.
10. As a customer, I want to see the remaining budget, remaining bookings and expiry of a mandate, so that I know what my agent can still do.
11. As an agent, I want to query my own remaining headroom before proposing a booking, so that compliance is cheaper than discovering the ceiling by being refused.
12. As an agent, I want an attempt that exceeds the mandate to be refused before any Razorpay order is created, so that a doomed booking never becomes a payment I have to unwind.
13. As the platform, I want the ceiling check and the budget spend to be a single atomic statement, so that two concurrent confirms under one mandate cannot both pass and breach it.
14. As the platform, I want a mandate that is exhausted, expired or revoked to refuse every action under it, so that the three terminal states are enforced by the same statement as the ceilings.

**C. Agent decision log (customer, owner)**

15. As a customer, I want every step the agent takes - proposals, authorisations, captures, confirmations and compensations - recorded with what it asked for and what it got, so that the trail records intent, not only outcome.
16. As a customer, I want every refusal recorded with its deny reason and the mandate state at that instant, so that any decision can be replayed and explained using the constraints as they stood, not as they stand now.
17. As a customer, I want to read the ordered decision trace for a mandate from one endpoint, so that the audit trail is a thing I can look at rather than a claim.
18. As the platform, I want each decision to carry its latency, idempotency key, Razorpay order and payment ids and hold id, so that a row in the trace can be tied to the exact external artifacts it produced.

**D. Mandate-gated first-party agent (customer)**

19. As a customer, I want to attach a mandate to an agent conversation, so that the agent acting for me is the agent I bounded.
20. As a customer, I want spending inside my mandate to proceed without a per-action approval dialog, so that granting a mandate actually buys me something over the existing prompt.
21. As a customer, I want spending that would exceed my mandate to be refused with the specific reason rather than silently retried, so that I learn what my bound did.
22. As a customer, I want the agent to tell me in the conversation why it was refused, so that the failure is legible without reading a log.
23. As a customer, I want my remaining mandate headroom visible in the chat, so that I can see the bound being consumed as the agent works.
24. As a customer, I want to still be able to book directly in the UI without a mandate, so that bounding my agent never bounds me.

**E. Razorpay test-mode payments (platform)**

25. As the platform, I want a payment provider switch between the wallet and Razorpay, so that a network failure during recording cannot take the demo down.
26. As the platform, I want a Razorpay order created only after the gate has allowed the action, carrying the mandate, agent, user, hold and idempotency key in its notes, so that the webhook can close the loop without holding server-side session state.
27. As the platform, I want the signed webhook to be the source of truth for payment rather than any client callback, verified against the raw request bytes before parsing.
28. As the platform, I want a redelivered webhook to replay its stored outcome rather than book twice, so that Razorpay's at-least-once delivery is safe.
29. As the platform, I want the webhook and the agent's own confirm call to converge on one idempotency key, so that whichever arrives first commits and the other replays.
30. As a customer, I want a capture that succeeded but whose confirm failed to be refunded and the slot released, so that I am never charged for a table I did not get.

**F. Slot-fill revenue mechanic (owner, customer)**

31. As a café owner, I want each slot scored for demand from historical fill rate and current hold pressure, so that hot and cold slots are distinguishable by a number rather than a guess.
32. As a café owner, I want cold slots offered at a bounded discount when a customer's requested slot is unavailable, so that inventory that would perish unsold converts to revenue instead.
33. As a café owner, I want discounts capped at 20% of price and never below my floor, and never applied to a hot slot, so that the mechanic cannot destroy my margin.
34. As a customer, I want at most two alternatives offered per request, so that a counter-offering agent does not become spam.
35. As a customer, I want alternatives that my mandate would refuse never to be proposed at all, so that the gate is a backstop rather than something the agent walks into.

**G. Evaluation harness (platform)**

36. As the platform, I want a fixed-seed generator producing synthetic buyer intents, so that both arms face identical demand and the comparison is honest.
37. As the platform, I want an exact-match baseline arm and an agent arm over that same demand, so that the difference is attributable to the mechanic.
38. As the platform, I want fill rate, gross revenue, revenue per slot, denials by reason and over-refusal rate reported for both arms, so that the claim is a number rather than an adjective.
39. As the platform, I want mandate denials and platform denials counted separately, so that over-refusal measures the gate rather than pre-existing booking rules.
40. As the platform, I want double bookings asserted to be zero under concurrent retry as a test rather than a script, so that the safety claim is enforced by CI.

## Implementation Decisions

**A. Per-slot pricing in paise**

- `Cafe.priceBandMinor` (int, default 40000) is the café's base price. `Slot.priceMinor` (int) is the actual price, computed at seed time as band × hour multiplier - 19:00–21:00 ×1.5, 17:00–18:00 ×1.1, 12:00–14:00 ×1.0, 15:00–16:00 ×0.7 - with a further ×1.3 on Friday and Saturday. Price is frozen on the slot row, not computed at read time, so a quoted price and a charged price cannot diverge.
- `Cafe.maxDiscountMinor` (int) is the owner's discount floor, used by work area F.
- `wallet.constants.ts` moves to paise: `WALLET_SIGNUP_BALANCE` 500 → 50000. The flat `WALLET_CHARGE_AMOUNT` is **removed** - there is no longer a single charge amount.
- `chargeWallet(manager, userId)` gains an `amountMinor` parameter. `writeBookingAndCharge` resolves the slot's `priceMinor` and passes it to both the charge and `Payment.amount`. The conditional-decrement shape is unchanged; only the amount becomes dynamic.
- `insufficientBalanceMessage` divides by 100 for display. This is the only place paise become rupees; nothing else formats money.
- `TableAvailability` gains `priceMinor` so the slot grid and the agent both see the price. The availability cache stores it like any other field.
- **This work area blocks every other one.** It is done first, in one pass, before anything else starts.

**B. Mandate and the policy gate**

- `mandate` table per the source document §05: constraints (`maxPerBookingMinor`, `maxTotalMinor`, `maxBookings`, `allowedLocalities` as a Postgres text array, `windowStart`, `windowEnd`), consumption (`consumedMinor`, `consumedBookings`), lifecycle (`status`, `expiresAt`, `revokedAt`) and `signature`.
- Constraints are signed at grant time as HMAC-SHA256 over their canonical serialisation with `SERVER_SECRET`, and are immutable thereafter. Consumption columns are excluded from the signature - mixing them would invalidate the signature on every spend. The signature is a non-repudiation record, **not a bearer credential**; it is never accepted as authentication.
- `POST /mandates` grants (user JWT), `GET /mandates/:id` returns remaining headroom, `POST /mandates/:id/revoke` sets `status = REVOKED` and `revokedAt`.
- **The gate runs in two places, and this overrules source document §04.** The source places a single check-and-consume before Razorpay order creation. That leaks budget permanently on any abandoned checkout, and its justification - that creating an order is the first irreversible act - is false, since nothing moves until capture. Instead:
  - `previewMandate()` at intent time is a **read-only** ceiling check. It returns `ALLOW` or `DENY` with a reason, writes nothing, and on `DENY` no Razorpay order is created. This is what fires in the demo's refusal beat.
  - `authorizeAndConsume()` is the **binding** check: one conditional `UPDATE … RETURNING` evaluating every ceiling in the same statement as the increment, run **inside `executeConfirm`'s existing transaction**, beside `chargeWallet` - which is already exactly this shape. Zero rows returned is the denial and rolls the transaction back.
- The source document's core claim is preserved verbatim: the check and the spend are one atomic statement, and no read-then-write or advisory lock exists anywhere in the path. Only its position moves, from intent to confirm.
- Abandoned intents therefore cost nothing, no reserved-budget column is needed, and no sweeper is needed to reclaim leaked budget.
- The preview being racy is acceptable because it is advisory. A request that wins the preview and loses the binding check lands in the compensation path, which is a demonstrated behaviour rather than a defect.
- Locality is matched against the café's `area`. Window is matched against the slot's `slotTime`.
- **Verdicts are binary, `ALLOW` and `DENY`.** `REQUIRES_HUMAN` is cut (source document §12 cut line 3).

**C. Agent decision log**

- `agent_decision` table per source document §07. Written in the same transaction as the booking write where one exists; in its own insert where the step has no transaction (proposals, previews).
- Steps recorded: `PROPOSE`, `AUTHORIZE`, `CAPTURE`, `CONFIRM`, `COMPENSATE`. `DISCOVER` is omitted - search and availability move no money and would dominate the trace with noise.
- `constraints_snap` is a JSONB copy of the mandate's constraint and consumption state at decision time. This is what makes a refusal replayable; without it the trace explains a past decision using present state.
- `GET /agent/decisions?mandateId=` returns the ordered trace. This endpoint is the audit-trail demo.
- A minimal web view of the trace is optional; `curl` output on screen is acceptable for the recording.

**D. Mandate-gated first-party agent**

- **The first-party Gemini agent carries the demo.** The MCP surface of source document §09 is cut in full for the two-day window, and with it the `agent_keys` table and `AgentKeyGuard` designed for it. The agent already authenticates as the user through the JWT the worker mints from `agent_workflows.email`, so no new auth object is needed.
- `agent_workflows.mandateId` (nullable uuid) attaches a mandate to a conversation. Null means the agent runs under the existing per-action approval behaviour, unchanged.
- `get_mandate_status` is added to `agent-tools.service.ts` as a sixth tool, calling `GET /mandates/:id`. Good agent APIs make compliance cheaper than violation; this is the cheap path.
- `confirm_hold` routes through the gate. A `DENY` is returned to the LLM as a structured tool result carrying verdict, reason and remaining headroom - not thrown - so the agent can explain it in the conversation and adapt rather than retry blindly.
- **Approval policy changes**: with a mandate attached, spending inside the bounds proceeds without parking in `AWAITING_APPROVAL`. That is the entire value of granting one. Spending that the preview denies is refused outright. `AWAITING_APPROVAL` remains for the no-mandate path and is otherwise untouched - it is the trickiest existing code and this PRD does not restructure it.
- The system prompt tells the agent its mandate bounds and instructs it to check headroom before proposing.
- Chat UI shows a mandate chip with remaining budget.
- **A human booking directly in the UI is deliberately unbounded by the mandate.** A mandate bounds delegated authority, not the account holder's own money. The gate is applied on the agent path, not globally.

**E. Razorpay test-mode payments**

- **Order of work overrules source document §12.** A two-hour throwaway spike proves order creation, the raw-body webhook and signature verification against the deployed Render URL *first*, to de-risk the integration. The thesis is then built entirely on `PAYMENT_PROVIDER=wallet`, and Razorpay is wired in properly afterwards, against a confirm path that has stopped moving. None of the three artifacts that must not be cut - the denial demo, the compensation demo, the batch numbers - depend on Razorpay, so it must not sit underneath them.
- `rawBody: true` in `NestFactory.create`. `express.json()` destroys the exact bytes the signature is computed over; the signature is verified against the raw body before anything parses it.
- `RazorpayClient` is an injectable service exposing `orders.create` and `payments.refund`, with a stub implementation selected by env - the established mock-gateway-via-DI pattern this repo already uses for Nominatim.
- `PAYMENT_PROVIDER=wallet|razorpay` switches at the charge seam inside `writeBookingAndCharge`. Exactly one of the two runs; they never both charge.
- Order notes carry `mandateId`, `agentId`, `userId`, `holdId` and `idempotencyKey`. The last two are what let the webhook complete a booking with no server-side session state.
- **Both the webhook and the agent's confirm call invoke `confirmHold` with the same idempotency key.** Whichever arrives first executes and stores its outcome; the second replays it through the existing `IdempotencyKey` machinery, which already has an e2e suite. This resolves the contradiction between source document §08 (webhook is the writer) and §09 (the agent's `confirm_booking` is the writer) without new concurrency code: the agent gets a synchronous answer, and the booking still commits if the agent disappears after capture.
- Webhook redelivery is therefore already safe, and **the unique index on `razorpay_pay_id` that source document §08 calls for is redundant**. `Payment.razorpayPaymentId` is still added as a nullable unique column, written on success, because the decision log needs to reference it - it is an audit link, not a correctness mechanism.
- `HOLD_TTL_SECONDS` 90 → 300, in `render.yaml` and `.env.example`. The hold must now survive intent creation, checkout and webhook delivery.
- **Compensation is an inline refund in the confirm failure path**, marked with a `ponytail:` comment naming the crash window and the upgrade path. The durable version - writing the payment row as `CAPTURED` before confirm and adding a fourth `SELECT … FOR UPDATE SKIP LOCKED` sweeper, copying `notifications/outbox-worker.service.ts:43` - is deliberately deferred. The gap is disclosed rather than hidden.
- The hold is consumed before the transaction opens, so a failed confirm has already released the slot; compensation is refund-only.
- The compensation path does not need an injected failure to be real: with the binding gate inside the confirm transaction, a concurrent booking exhausting the mandate while the buyer is on the checkout page produces a genuine capture-then-deny. The harness's injected failures supplement this rather than standing in for it.

**F. Slot-fill revenue mechanic**

- The seed writes **six weeks of past reservations** from a fixed RNG seed, weighted by hour and day (19:00–21:00 ≈ 0.85 booked, 17:00–18:00 ≈ 0.55, 12:00–14:00 ≈ 0.45, 15:00–16:00 ≈ 0.15, ×1.3 Friday and Saturday). Without this, `historical_fill_rate` is zero for every slot on a fresh database, every slot scores below the cold threshold, every slot is discounted, and the mechanic becomes the margin-destruction machine the source document warns against - with a negative revenue delta as the headline number.
- `demandScore(cafeId, dayOfWeek, hourBucket)` = `historical_fill_rate × 0.7 + current_hold_pressure × 0.3`, both in 0..1. Cold is `< 0.35`.
- `nudgeMinor = min(0.20 × priceMinor, cafe.maxDiscountMinor)`. Cold slots only; a hot slot is never discounted at any size.
- Alternatives are proposed when the requested slot is unavailable, or when a cold slot exists inside the buyer's stated window. Maximum two per request.
- **Every candidate alternative is run through `previewMandate` before being proposed.** An alternative the mandate would refuse is filtered out, not offered and then denied.
- Referred to as slot-fill or smart order routing across perishable capacity, not as upsell - the latter invites comparison to infinite-stock mechanics this deliberately is not.

**G. Evaluation harness**

- **30 synthetic intents**, not the source document's 50–100. The seed is fixed either way; 30 gives the same directional result for materially less debugging on a two-day clock.
- **One synthetic user per intent.** The existing 10-hour-window rule (one active reservation per user per café within ±10h) would otherwise dominate the outcome, and `slot_fill_rate` would be measuring that rule rather than the mechanic.
- Arm A is exact-match only: requested slot unavailable means no booking. Arm B has slot-fill active and every action mandate-gated. Both consume the same generated demand.
- **Razorpay is stubbed at the client boundary**, not below it. `orders.create` returns a synthetic order id; the harness self-signs a `payment.captured` payload with the configured webhook secret and POSTs it to the real webhook route. Everything from signature verification downward - notes parsing, `confirmHold`, the mandate consume, the booking write, the outbox - is the same code the demo runs. Paying 30–60 real test orders requires interactive checkout and is not achievable headlessly; the wallet arm would instead exercise a path the demo does not use. The HMAC signing helper is owed to the webhook test regardless.
- Metrics: `slot_fill_rate`, `gross_revenue_minor`, `revenue_per_slot`, `mandate_denials` grouped by reason, `platform_denials`, `over_refusal_rate`, `compensations_ok`, `double_bookings`.
- **`mandate_denials` and `platform_denials` are counted separately**, and `over_refusal_rate` counts mandate denials only. Folding the 10-hour window rule and taken-slot conflicts into over-refusal would corrupt the one metric the source document claims nobody else reports.
- Injected failures: confirm is forced to throw after successful capture on approximately 5% of runs. `compensations.failed` must be zero.
- Output is JSON plus a Markdown table for the README.
- **Timebox: if the harness is not producing numbers by 14:00 on 2026-09-05, it is cut**, and the README states that the mechanic ships without batch evidence. The recording block does not slip.

## Testing Decisions

- A good test exercises **external behavior at the HTTP seam** - request in, response and observable state out - never internal wiring. This repo's established style: supertest e2e specs against the real app with real Postgres and Redis, per-spec truncation, shared fixture helpers.
- **One seam, the existing one.** New e2e specs:
  - *Pricing:* a confirmed booking charges the slot's `priceMinor`, not a constant; the payment row records the same amount; availability exposes the price; an insufficient balance names the remainder correctly in rupees. The existing `wallet.e2e-spec`, `confirm-payment.e2e-spec` and `booking.e2e-spec` are migrated to paise - this is larger than it looks and is budgeted as its own task.
  - *Mandate - the critical test:* N parallel confirms against one mandate with headroom for fewer than N. Assert that `consumedMinor` never exceeds `maxTotalMinor`, that exactly the affordable number of bookings exist, and that every loser produced a `DENY` decision row. This is the deepest claim in the submission; if it does not go green there is no thesis. Modelled on the existing concurrent double-booking specs.
  - *Mandate lifecycle:* per-booking ceiling, total ceiling, booking count, locality mismatch, window mismatch, expired, revoked and exhausted each produce their own deny reason with nothing written.
  - *Preview:* a denied preview creates no Razorpay order and no mandate mutation; an allowed preview mutates nothing either.
  - *Decision log:* a denied attempt writes a row carrying the deny reason and a constraint snapshot matching the mandate state at that instant, not its later state; the trace endpoint returns steps in order.
  - *Razorpay:* a payload signed with the wrong secret is rejected before parsing; a correctly signed `payment.captured` commits the booking; the same payload redelivered replays and books once; the agent's confirm and the webhook racing on one key produce exactly one booking.
  - *Compensation:* capture succeeds and confirm throws → a refund is issued, the hold is released, and a `COMPENSATE` decision row exists.
  - *Harness:* `double_bookings === 0` under concurrent retry is asserted as a test, not printed by a script.
- Prior art to follow: `double-booking.e2e-spec`, `hold-confirm.e2e-spec`, `idempotent-confirm.e2e-spec`, `agent-resilience.e2e-spec`.
- **Frontend is manual-verification only**, consistent with prior PRDs: the price on the slot grid, the mandate chip, and the grant form. The repo has no web test runner and this PRD does not add one.

## Out of Scope

- **The MCP agent surface** and everything designed for it - the `agent_keys` table, `AgentKeyGuard`, the seven-tool wrapper set, and the stdio-versus-remote transport decision. Deferred wholesale; the first-party agent carries the demo. This is the largest single cut and the first thing to build next.
- **`REQUIRES_HUMAN` step-up verdict.** Binary allow/deny ships.
- **The refund sweeper.** Inline refund with a disclosed crash window ships instead; the payment row keeps its current meaning (written on success, one per reservation, non-null `reservationId`).
- **Cross-sell and add-on products** (desserts, birthday setups, merchandise). Infinite-stock inventory is the easy case this submission's thesis says existing agent rails already handle; building it makes the submission look more like everyone else's, and it costs a new schema.
- **Campaign orchestration** - audiences, journeys, multi-channel sequencing. A separate product, a week of work minimum, and off-thesis. The one on-thesis slice (a cold slot at T-2h enqueueing a notification to users whose history matches, reusing `demandScore`, the seeded history and the notifications outbox) is optional polish on the final afternoon and is the first thing cut after the harness.
- **Any claim of conformance to a named agent-catalog specification.** The `.well-known/agent-commerce.json` discovery document ships if time allows, described as an agent-readable catalog. Conformance to a spec that cannot be cited is not claimed in the README.
- **Two-way partner sync**, unchanged from PRD 0015.
- **Wallet top-up, transaction history, mandate templates, multi-agent mandates, mandate delegation.**
- **A DB-level exclusion constraint** for the mandate ceilings. The conditional `UPDATE` is the enforcement point.
- **Sharding mandate consumption into an append-only ledger.** Named in the panel defence as what breaks first at scale; not built.

## Further Notes

- **Build order.** A (pricing, blocks everything) → B (mandate and gate) → C (decision log) → D (agent gating) on 2026-09-04, with the Razorpay spike slotted into that morning and the real integration after B lands. F and G on the morning of 09-05, killed together at 14:00 if not running - Arm B is meaningless without the slot-fill mechanic, so they are one unit. README and recording from 14:00.
- **Critical path is B: mandate table → preview → `authorizeAndConsume` → wired into `executeConfirm` → concurrency test.** Everything else is prerequisite plumbing or presentation.
- **Three tasks are easy to underestimate:** the paise migration's test churn (touches more specs than it appears to), the approval-policy change in D (interacts with `AWAITING_APPROVAL` park-and-resume, the trickiest existing code), and the harness's self-signed webhook helper (where debugging time will actually go).
- **Provenance.** Tag `substrate-v1` at `cd55182` before the first buildathon commit. `git log substrate-v1..HEAD` is then mechanically the substrate/new split. Source document §03 proposes squash-importing into a fresh repository; **do not** - that destroys the twenty-plus dated milestone commits the panel defence points at as evidence. This repository already carries the full history and records the original as its `upstream` remote, which is strictly better than what §03 describes.
- **What was substrate and what is new.** Substrate: booking core, Redis holds with TTL and compare-and-swap release, idempotent confirm with stored-outcome replay, two transactional outboxes, saga compensation, partner API keys and webhooks, durable agent workflows, the 10-hour window rule, rate limiting, cache-aside. New: per-slot pricing, mandate and policy gate, agent decision log, Razorpay integration, slot-fill mechanic, evaluation harness.
- **Four decisions in this PRD overrule the source document**, and each should be stated as a deliberate choice rather than discovered by a reviewer: the gate consumes at confirm rather than at intent (§04); the webhook and the agent converge on one idempotency key rather than one of them owning the write (§08 versus §09); Razorpay is integrated late rather than first (§12); and the MCP surface is cut rather than built (§09).
- **Known gaps to disclose before being asked:** the inline refund's crash window; the harness stubbing Razorpay at the network boundary; both arms sharing one synthetic demand seed; and the mandate row being a write hotspot that serialises every booking under one mandate.
