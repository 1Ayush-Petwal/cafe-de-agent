# M1 locking-strategy contention comparison

Generated 2026-07-02T22:13:24.065Z by `npm run benchmark:locking --workspace=apps/api` (apps/api/scripts/benchmark-locking.ts). N concurrent HTTP booking requests hit the same table+slot; "won" must be exactly 1 for correctness, everyone else should see 409.

| Strategy | Concurrency | Won | Lost (409) | Errored | Wall time (ms) | Throughput (req/s) |
|---|---|---|---|---|---|---|
| unique | 5 | 1 | 4 | 0 | 24 | 208 |
| pessimistic | 5 | 1 | 4 | 0 | 12 | 417 |
| optimistic | 5 | 1 | 4 | 0 | 16 | 313 |
| unique | 20 | 1 | 19 | 0 | 39 | 513 |
| pessimistic | 20 | 1 | 19 | 0 | 46 | 435 |
| optimistic | 20 | 1 | 19 | 0 | 31 | 645 |
| unique | 50 | 1 | 49 | 0 | 69 | 725 |
| pessimistic | 50 | 1 | 49 | 0 | 72 | 694 |
| optimistic | 50 | 1 | 49 | 0 | 65 | 769 |
| unique | 100 | 1 | 99 | 0 | 140 | 714 |
| pessimistic | 100 | 1 | 99 | 0 | 119 | 840 |
| optimistic | 100 | 1 | 99 | 0 | 118 | 847 |

## Reading the numbers

- **Correctness (the headline result)**: `won` is 1 and `won + lost (+ errored)` equals the concurrency level for every row — all three strategies close the M1 race at every contention level tested. The naive M0 path (no locking at all) does not: `apps/api/test/double-booking.e2e-spec.ts` run against the pre-M1 `reservations.service.ts` (see the M0 commit, `book()`) double-booked 4 of 10 concurrent requests for the same table+slot.
- **Throughput, honestly**: at this scale (single local Postgres, loopback network, the default node-postgres pool of ~10 connections) the three strategies land within noise of each other — the client-side connection pool is the bottleneck, not the DB-level locking behavior each strategy is meant to demonstrate. That is itself a real finding: **you need genuine multi-connection contention (a larger pool, multiple app instances, or a slower/loaded DB) before pessimistic-vs-optimistic tradeoffs show up in wall-clock numbers** — below that threshold, the mechanism matters for the interview whiteboard, not for this local benchmark.
- **Mechanism (why each still matters to know)**:
  - *Unique constraint*: every request races to insert; Postgres serializes at the index level and rejects losers with `23505`. No explicit lock is held, so it fails fast under any contention.
  - *Pessimistic (`SELECT ... FOR UPDATE` on the slot row)*: the second request blocks until the first commits or rolls back — correct and simple to reason about, but it's a real lock: it would show up as growing wall time under genuine contention (many real concurrent DB connections, not just many HTTP requests funneled through one small pool), and it serializes *all* tables at that slot, not just the one being booked.
  - *Optimistic (slot `version` compare-and-swap)*: no lock is held; every loser instead retries a read-check-CAS cycle. Cheapest when contention is rare, but retry storms under sustained high contention are the classic failure mode — again, not reproducible from one process's connection pool.
- All three share the same permanent backstop regardless of strategy: the partial unique index on `(tableId, slotId) WHERE status = 'booked'` on the reservations table, so even a bug in the pessimistic/optimistic paths cannot actually double-book — the final insert would 23505.
