# PRD: Kaforia — Delhi store locator, 10h booking window, ₹25 wallet, PWA + themes, slot-grid UX, Partner API v1 (spec)

> Local mirror of [1Ayush-Petwal/Project-1/issues/15](https://github.com/1Ayush-Petwal/Project-1/issues/15) — GitHub is the source of truth. Label: `ready-for-agent`.

> **Source:** `docs/pr_reqs/Kaforia.md` (voice-note requirements + Dalkom Cafe / Starbucks reference images in `docs/pr_reqs/assets/`), refined in a grilling session on 2026-07-07. Every decision below was agreed with the product owner in that session.

## Problem Statement

Six user-facing problems, one per work area:

1. **Slot generation looks rigged (owner).** An owner typed `014` into the slot-grid form; the leading zero stuck in the input, and the result message said "Created 104 new slot(s)" with no explanation — when they expected something related to 14. (Investigation: the backend was correct — 14 days × 13 slots/day, minus 6 days that already had slots = 104 new. The *presentation* destroyed trust.)
2. **Tables can be hoarded (customer/owner).** A single customer can book any number of tables at the same café for the same evening. Nothing limits them.
3. **Bookings are free (customer/owner).** With no cost per booking there is no friction against mass-booking, and the platform has no notion of a customer paying anything.
4. **Discovery is a bare list (customer).** The home page is a flat list of café names. No map, no distance, no open/closed status, no cuisine, no rating. A customer planning ahead from another part of the city ("cafés near Hauz Khas, best Italian") has no way to do it.
5. **No installable mobile experience (customer).** Mobile users get a desktop-shaped website. The booking grid doesn't show tables the way the approved mobile designs do (visual table cards with per-table capacity).
6. **One flat look (customer).** The product has a single visual style regardless of time of day; the approved designs specify a warm daytime look and a dark candlelit dinner look.

Plus one platform gap: **cafés live in their own local apps (owner/partner).** A booking made on our platform never appears in the café's day-to-day system, so staff must double-enter or miss reservations.

## Solution

From the customer's perspective: open the app (installable as a PWA on mobile) and land on a Starbucks-style store locator for Delhi — a map with pins beside a card list showing distance, open/closed, cuisine and rating. Search one box for a café by name *or* type a locality ("Hauz Khas") to re-center the map and re-sort by distance from there; or flip a toggle to browse by cuisine, best-rated first. Pick a café, see its tables as cards with seat counts (Reserved badges where taken), pick a slot pill and a date pill, and confirm — which costs ₹25 from a fake in-app wallet that starts at ₹500 and refunds on cancellation. The whole app wears a warm cream/gold theme by day and a dark amber dinner theme in the evening. You can hold at most one active reservation per café within any 10-hour window, so tables can't be hoarded.

From the owner's perspective: the slot-grid form behaves predictably (no sticky leading zeros; the result message explains created vs skipped days), cafés gain locator fields (location, hours, cuisines), and — specified here, built later — a Partner API lets their local app receive every booking we take via webhooks and pull the day's bookings on demand.

## User Stories

**A. Slot-grid form trust (owner)**

1. As a café owner, I want the "days ahead" field to normalize what I type (strip leading zeros, clamp to the allowed 1–60 range), so that the number I see is exactly the number the system uses.
2. As a café owner, I want the slot-generation result to state how many slots were created across how many new days and how many days were skipped because they already had slots, so that partial creation never looks like a malfunction.

**B. One booking per café per 10-hour window (customer)**

3. As a customer, I want the platform to allow me only one active reservation per café within any 10-hour window, so that no one can hoard a café's tables.
4. As a customer, I want a clear conflict error naming my existing booking's time when I try to double-book a café, so that I understand why I was refused and what to cancel.
5. As a customer, I want cancelling my reservation to immediately free me to book that café again, so that a change of plans doesn't lock me out.
6. As a customer, I want to book two *different* cafés in the same evening, so that the limit only applies within one café.
7. As a customer, I want the same-café limit rejected at hold time (before checkout starts), so that I don't walk through payment for a booking that can never succeed.
8. As a customer, I want the AI booking agent to be bound by the same limit, so that delegating a booking can't bypass the rule.

**C. ₹25 wallet charge per booking (customer)**

9. As a customer, I want a wallet with a fake starting balance of ₹500 when I sign up, so that booking costs are simulated without real payment infrastructure.
10. As a customer, I want each confirmed booking to cost a flat ₹25 from my wallet, so that bookings have a cost and mass-booking has friction.
11. As a customer, I want a payment-required error showing my remaining balance when I can't afford a booking, so that I know why it failed.
12. As a customer, I want a cancelled booking to refund its ₹25 to my wallet, so that changing plans doesn't cost me (fake) money.
13. As a customer, I want my wallet balance visible in the app header, so that I always know what I can spend.
14. As a customer, I want the confirm button to show the price ("Confirm — ₹25"), so that spending is never a surprise.
15. As a customer, I want a double-clicked or retried confirm to charge me exactly once, so that flaky networks never double-charge me.
16. As a customer, I want a failed booking (lost race, expired hold) to leave my balance untouched, so that I only ever pay for tables I actually got.

**D. Store-locator home page, Delhi (customer)**

17. As a customer, I want the home page to show Delhi cafés as a card list beside an interactive map with pins, so that I can see where everything is at a glance.
18. As a customer, I want each card to show name, area, distance from me, open/closed status, cuisines and star rating, so that I can compare cafés without opening each one.
19. As a customer, I want a Directions button on each card that opens my maps app routed to the café, so that I can navigate there in one tap.
20. As a customer, I want clicking a map pin to highlight its card (and vice versa), so that the list and map stay connected.
21. As a customer, I want one search box that instantly filters cafés by name or area as I type, so that finding a known café is immediate.
22. As a customer, I want that same box to offer "search as a locality" for what I typed, so that I can plan from a place I'm *not* currently at.
23. As a customer, I want a locality search to re-center the map and recompute every card's distance from that point (re-sorting nearest-first, without hiding any café), so that I can plan ahead from anywhere.
24. As a customer, I want a visible chip showing which locality distances are measured from, with one tap to clear back to my GPS location, so that I'm never confused about what "2.3 km" means.
25. As a customer, I want a graceful "area not found" message when a locality can't be resolved, so that a failed search never breaks the page.
26. As a customer, I want distances simply omitted when I deny location permission and haven't searched a locality, so that the page still works without tracking me.
27. As a customer, I want a toggle between Distance mode and Cuisine mode, so that I can browse nearest-first or best-of-a-cuisine-first.
28. As a customer, I want Cuisine mode to show cuisine chips (Italian, Continental, Asian, …) and order the filtered list best-rated first, so that "best Italian in Delhi" is one tap.
29. As a café owner, I want to set my café's cuisines (and have location/hours on the café record), so that my café appears correctly in the locator.

**E. PWA + mobile booking redesign (customer)**

30. As a mobile customer, I want to install the app to my home screen and have it open standalone, so that it feels like a native app without an app store.
31. As a mobile customer, I want the app shell to load instantly (even offline) while live data always comes from the network, so that the app is fast but availability is never stale.
32. As a customer, I want the booking screen to show each table as a card with its seat capacity (e.g. "B1 · 4 seats") and a Reserved badge when taken, so that picking a table matches the approved Dalkom design.
33. As a customer, I want time slots and dates as tappable pills with a single "Reserve a Table" action, so that booking on a phone is a three-tap flow.
34. As a desktop customer, I want the same booking components in a wider layout, so that desktop keeps working with no separate codebase.

**F. Day/dinner themes (customer)**

35. As a customer, I want the app to wear a warm cream/gold theme during the day (06:00–17:00 local) and a dark amber dinner theme in the evening, so that the ambience matches the visit I'm planning.
36. As a customer, I want a small sun/moon toggle to override the automatic theme, with my choice remembered, so that I'm in control of how the app looks.
37. As a customer, I want both themes applied consistently across the locator, booking, reservations and agent screens, so that the app never looks half-styled.

**G. Partner API v1 — one-way sync (specified here; built as a follow-up)**

38. As a café owner, I want to generate and revoke an API key scoped to my café from my dashboard, so that I can connect my local app without exposing anyone else's data.
39. As a café's local app (partner integration), I want webhook notifications for every booking created or cancelled at my café, so that reservations appear in my system near-real-time without double entry.
40. As a café's local app, I want pull endpoints for my café's bookings and availability by date, so that I can reconcile after downtime instead of trusting webhooks alone.
41. As a café owner, I want webhook delivery to retry on failure, so that my local app being briefly down never silently loses a booking.
42. As a café owner, I want to take a table out of service from my dashboard (existing feature) as the interim way to block platform bookings for walk-ins, so that one-way sync is workable until two-way sync ships.

## Implementation Decisions

**A. Slot-grid form (frontend-only)**
- The "days ahead" field keeps meaning *days ahead*. Normalization is purely client-side: strip leading zeros on change, clamp to the API's existing 1–60 bounds. The slot-generation backend is untouched — it was verified correct.
- The result message changes from a bare count to created-vs-skipped: "Created N slots across D new days (K days already had slots — skipped)." The generation endpoint must return (or the client must derive) enough information to state this.

**B. 10-hour booking window**
- Rule: when booking/holding a slot at café X with slot time T, reject if the user has an active reservation (status `booked`; `cancelled` never counts) at café X whose slot time satisfies |existing − T| < 10 hours. Rolling window, not calendar-day. Different cafés are independent.
- Enforced once in the reservations service, applied at all three entry points: hold creation (fail fast, before the Redis hold is taken), direct book, and confirm execution (authoritative, alongside the write). The agent books through the same service, so it inherits the rule with zero agent-side work.
- Violation → HTTP 409 naming the conflicting booking's slot time.
- **No DB-level exclusion constraint** (it would require denormalizing café and slot-time onto reservations plus a GiST index). The app-level check leaves a small same-user self-race window; accepted deliberately, revisit only if observed.

**C. Wallet**
- `walletBalance` integer (whole rupees) on the user record; new signups and seeded users start at ₹500. No paise precision — the price is a flat ₹25.
- The charge is a single conditional decrement (balance reduced only where balance ≥ 25, success detected by affected-row count) executed **inside the existing confirm transaction** that already atomically writes reservation + payment + notification-outbox job. Zero rows affected → HTTP 402 with the remaining balance; nothing is booked, nothing is written.
- This **replaces the coin-flip mock payment gateway** — the wallet is now the fake payment system. The payment record gains an `amount` (25).
- The direct book path (non-hold strategies) charges identically — no free side door.
- Cancellation refunds ₹25 to the wallet in the same operation that cancels.
- Idempotent confirm (existing Idempotency-Key machinery) must yield exactly one charge for replayed confirms; a hold that expires or a lost booking race charges nothing (the charge lives inside the transaction that only commits on success).
- UI: balance in the nav header; confirm button labeled with the price.

**D. Store locator**
- Café record gains: latitude, longitude, `region` (default `delhi`), opening hour, closing hour, `cuisines` (Postgres text array — deliberately no join table for filter chips), `rating` + `ratingCount` (seeded plausible values; owner-editable cuisines). Delhi seed data gets real coordinates.
- Café list endpoint gains `region`, `cuisine`, `sort=rating` parameters. The existing cache-aside café-list cache stores the full unfiltered list; filtering/sorting applies after the cache read (tiny list — avoids cache-key explosion per filter combination).
- Map: Leaflet + OpenStreetMap tiles (react-leaflet). Free, no API key, no billing. Explicitly not Google Maps embed.
- Directions: Google Maps universal directions URL (plain deep link, no API key).
- Distance: haversine computed client-side from the active origin — browser geolocation, or the geocoded locality when one is set. Permission denied + no locality → distances omitted.
- Geocoding: a new small geo module exposing one endpoint (locality query → coordinates + display name). It wraps **Nominatim** (OpenStreetMap's free geocoder): query bounded to a Delhi bounding box, results cached in Redis with a long TTL, calls proxied through our API to respect Nominatim's 1 req/sec policy. The Nominatim client is an injectable service so tests can stub it via DI (the established mock-gateway pattern). Geocoding fires only on explicit selection — never per keystroke.
- Search box: one combined input. Typing filters café names/areas instantly client-side; the last result row is always "search *«text»* as a locality," which triggers the geocode. Locality set → map re-centers, a dismissable "Measuring from: X" chip appears, distances recompute, list re-sorts. **Re-sort only — no radius filtering.** Unresolvable locality → "area not found," view unchanged.
- Sort modes: a segmented toggle, Distance vs Cuisine, mutually exclusive in v1. Distance mode hides cuisine chips and sorts nearest-first from the active origin. Cuisine mode shows chips and sorts the filtered cuisine best-rated first. All client-side state; the café list is already fully loaded.

**E. PWA + booking redesign**
- `vite-plugin-pwa` on the existing single codebase: manifest (name, icons, per-theme colors), service worker precaching the app shell only. All API data network-first; **no offline availability, no offline booking** — availability is live (SSE + 90-second holds) and stale cache here would show bookable tables that aren't.
- There is exactly one app: the PWA *is* the web app. No second codebase, no "switch."
- Booking screen redesigned to the Dalkom table-picker: table cards with capacity and Reserved badge, slot pills, date pills, single Reserve CTA driving the existing hold → countdown → confirm flow. Capacity is already in the availability API response — this is UI-only. Desktop renders the same components in a wider layout.

**F. Themes**
- Two palettes as CSS custom properties keyed off a root `data-theme` attribute (day: warm cream/gold; dinner: dark brown/amber, per the reference images). No theming library.
- Automatic switch by the user's clock: day 06:00–17:00, dinner otherwise. Manual sun/moon override persisted in localStorage wins over the clock.

**G. Partner API v1 (specification only — implementation is a follow-up issue, built last)**
- Per-café API keys: owner-generated and revocable from the dashboard, scoped to that café only, hashed at rest.
- Webhooks out: owner registers their local app's endpoint; `booking.created` and `booking.cancelled` events are delivered by the existing transactional-outbox + worker pattern (a second consumer of the mechanism that already guarantees notification jobs commit atomically with bookings) — with retries.
- Pull endpoints: café-scoped bookings-by-date and availability-by-date, API-key authenticated.
- **Two-way sync is v2, explicitly deferred**: letting the café's local app block our slots (external reservations) makes their system a second writer into our inventory and requires cross-system conflict handling. Interim stopgap: the existing take-table-out-of-service owner control.

## Testing Decisions

- A good test exercises **external behavior at the HTTP seam** — request in, response + observable state out — never internal wiring. This repo's established style: supertest e2e specs against the real app with real Postgres and Redis, per-spec truncation, shared fixture helpers.
- **One seam, the existing one.** New e2e specs at that seam:
  - *10-hour window:* second booking at the same café within 10h → 409; ≥10h apart → allowed; different café same time → allowed; cancel frees the window; the hold endpoint rejects fast; cancelled reservations never count.
  - *Wallet:* signup grants ₹500; confirmed booking decrements to ₹475 with a payment recorded; balance < 25 → 402 naming the remainder and no reservation written; cancel refunds; replayed confirm with the same Idempotency-Key charges exactly once (extends the existing idempotent-confirm spec); expired hold / lost race → balance untouched.
  - *Locator API:* café list filtered by region and cuisine, sorted by rating; new café fields present; cached-list behavior unchanged by filter params.
  - *Geocoding:* locality endpoint with the Nominatim client stubbed via DI override (the established mock-gateway pattern — no live network in tests); Redis cache hit skips the upstream call; unknown locality → not-found shape.
- Prior art: the concurrent double-booking specs, hold-confirm specs, payment-failure specs, idempotent-confirm specs.
- **Frontend is manual-verification only** (product-owner decision): locator UI, map, themes, PWA install, table-picker, and the days-ahead input fix. The repo has no web test runner and this PRD does not add one.
- Partner API: no tests now — specification only; its specs get written at the same HTTP seam when it's built.

## Out of Scope

- **Menus and food ordering.** The reference designs show menu browsing and "Order Now" — explicitly not being built; the images are theme/layout reference only.
- Real user reviews/ratings (v1 rating numbers are seeded; the post-visit "rate your booking" flow is the named v2).
- Favourites / Previous tabs on the locator; ETA minutes (needs a routing API); amenity icons; per-keystroke geocode autocomplete.
- Multi-city/region rollout (region groundwork here aligns with the M7 design doc, issue #14, which stays design-only).
- DB-level exclusion constraint for the 10-hour rule.
- Push notifications; offline booking or offline availability.
- Wallet top-up, paise precision, transaction-history UI, no-refund cancellation policies.
- Partner API implementation (spec'd above, built as its own follow-up) and all two-way sync.
- Native iOS/Android apps.

## Further Notes

- Suggested build order: A (trivial trust fix) → B + C (booking-core rules, same service, same specs area) → D (schema + locator) → E (PWA + booking redesign, depends on D's page structure) → F (themes over the new UI) → G (partner API, separate follow-up issue when picked up).
- The `014` investigation is worth preserving: user-visible count 104 = 14 requested days × 13 slots/day minus 6 already-populated days. The backend math was right; requirement A exists because the UI let a correct answer look rigged.
- The 10-hour window and wallet both live in the reservations service's existing choke points — the same places the concurrency strategies and idempotency machinery already guard — so the agent, the web UI, and any future partner writes all inherit them automatically.
