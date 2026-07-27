# Café De

A café booking app. You pick a café near you, pick a time, and book it — the
whole thing takes a few taps. There is also an AI agent you can just talk to:
*"book me a quiet café for 3 near Connaught Place this Saturday evening"*, and
it does the searching, holding and confirming for you.

Scoped to one region (Delhi) on purpose, so the café list is curated and the availability you see is real rather than a demo grid

## What you can do

**As a customer**

- Browse cafés in your region, search by locality, sort by distance or rating.
- See live availability per café — the grid updates itself as other people book.
- Hold a table while you decide (holds expire on their own, so nothing gets
stuck), then confirm. ₹25 comes out of an in-app wallet you start with ₹500 in.
- Book in natural language via the agent, which asks you before it spends money.
- See and cancel your bookings; get a notification when one is confirmed.

**As a café owner**

- Add your café, its tables, and generate bookable slots.
- Watch the day's bookings come in.
- Issue API keys and a webhook URL so a partner app can read availability and
receive booking events.

One booking per person per café inside a ±10 hour window — you can't quietly
reserve the whole evening.

## Stack

NestJS + TypeScript API, PostgreSQL as the source of truth, Redis for holds,
cache and pub/sub, React + Vite frontend with a Leaflet map, Gemini for the
agent. One API process serves the SPA and runs the background loops in-process.

## Run it locally

```bash
npm install
cp apps/api/.env.example apps/api/.env   # add GEMINI_API_KEY for the agent
npm run db:up                            # Postgres + Redis via Docker
npm run seed
npm run dev                              # API on :3000, web on :5173
```

```bash
npm test        # E2E suites (spins up Postgres + Redis itself)
npm run typecheck
```



## How it works

The booking core is synchronous and transactionally correct; everything slow or
failure-prone hangs off it asynchronously.

- **No double-booking.** Reserving is atomic in Postgres, and a partial unique
index on `(tableId, slotId)` for booked rows is the backstop. Three locking
strategies are implemented and benchmarked — see
[docs/m1-locking-comparison.md](docs/m1-locking-comparison.md).
- **Holds** live in Redis with a TTL, so an abandoned checkout releases itself
without holding a database lock open.
- **Confirms are idempotent** — an idempotency key means a double-click books
once. See [docs/idempotency-keys.md](docs/idempotency-keys.md).
- **Side-effects can't lose data or block the booking.** Notifications and
partner webhooks are written to an outbox in the same transaction as the
booking, then delivered by a worker loop with retries and a dead-letter queue.
- **Live availability** is server-sent events fanned out over Redis pub/sub.
- **The agent is just another API client.** It calls the same five public
booking tools a human client does, runs off the request path, pauses for your
approval before spending, and compensates (releases its holds) if a step fails.

More: [Idea.md](Idea.md) for the design rationale, [Roadmap.md](Roadmap.md) for
why each piece exists, [docs/deploy.md](docs/deploy.md) for deployment.