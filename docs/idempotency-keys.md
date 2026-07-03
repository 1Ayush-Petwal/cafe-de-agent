# Idempotency-Key on POST /reservations/confirm

M6 (issue #11): double-clicking "confirm" (or a client retrying a dropped
response) must never re-charge or re-book. `POST /reservations/confirm`
accepts an optional `Idempotency-Key` header; when present, the outcome of
the first request with that key is stored and replayed for every later
request with the same key, instead of re-executing the hold-consume +
mock-charge + reservation-write path.

## Keying rules

- **Scope: per user, per key string.** The stored record's primary key is
  `(userId, key)` — two different users can independently pick the same
  key string with no collision, since `userId` comes from the JWT, not the
  client. Clients are still expected to send a globally-unique token (a
  UUID) as the key; per-user scoping is a safety net, not a way to shorten
  the token.
- **One key per attemptable operation, not per click.** The frontend
  generates one key when a hold is created and reuses it for every confirm
  attempt against that hold (initial attempt, double-click, and any manual
  retry after an error) — see `CafeAvailabilityPage`'s `confirmKey` state
  and `api.confirmHold`. A *new* hold gets a new key.
- **A key is bound to its first request's parameters.** The stored record
  also holds a hash of `{ tableId, slotId, holdId }`. Reusing the same key
  for materially different parameters is rejected with `409 Conflict`
  rather than silently replaying an unrelated result — this catches client
  bugs (e.g. a stale key reused across two different holds) instead of
  masking them.
- **Endpoint-scoped.** This mechanism only exists for `POST
  /reservations/confirm` today; there is one idempotency table
  (`idempotency_keys`), not a per-endpoint namespace, because it currently
  has exactly one caller.

## Concurrency

Claiming a key is a plain `INSERT ... ON CONFLICT (userId, key) DO
NOTHING`. Two requests racing on the same key: the loser's insert reports
zero affected rows and reads back the existing record. If the winner has
already finished, the loser replays the stored result. If the winner is
still mid-flight (a true simultaneous double-click), the stored record's
`responseBody` is still `null`, and the loser gets `409 Conflict` — the
client is expected to retry the read (e.g. `GET /reservations/mine`) or
resubmit shortly rather than being served a fabricated result.

An unexpected failure (not a well-formed HTTP error — e.g. Postgres or
Redis themselves erroring) deletes the placeholder row rather than storing
it, so the key stays retryable instead of being permanently poisoned by an
infrastructure blip.

## Retention window

Idempotency records are retained for **24 hours** from `createdAt` — long
enough to cover any realistic client retry window (dropped connections,
manual retries, an agent's tool-call retry per issue #9/#10), short enough
that the table doesn't grow unbounded. There is no automatic purge job in
this repo yet (the same "BUILD vs DESIGN" split as the rest of the
project): a production deployment should run a periodic
`DELETE FROM idempotency_keys WHERE "createdAt" < now() - interval '24 hours'`
(e.g. from the existing worker process, alongside its outbox poll loop).
Because keys are effectively single-use per hold in normal operation,
never purging still can't cause incorrect behavior — it's a storage
concern, not a correctness one.
