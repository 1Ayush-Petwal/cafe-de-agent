# ₹25 wallet: balance on user, atomic charge on confirm, refund on cancel

> Local mirror of [1Ayush-Petwal/Project-1/issues/21](https://github.com/1Ayush-Petwal/Project-1/issues/21) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area C)

## What to build

A fake in-app wallet that makes every booking cost ₹25. Users get a wallet balance in whole rupees (no paise — the price is flat); new signups and seeded users start at ₹500. Confirming a booking charges ₹25 via a single conditional decrement (balance reduced only where balance ≥ 25, success detected by affected-row count) executed inside the existing confirm transaction that already atomically writes reservation + payment + notification-outbox job. Zero rows affected → HTTP 402 with the remaining balance; nothing is booked, nothing written.

This replaces the coin-flip mock payment gateway — the wallet is now the fake payment system, and the payment record gains an amount (25). The direct book path (non-hold strategies) charges identically — no free side door. Cancellation refunds ₹25 in the same operation that cancels. The existing Idempotency-Key machinery must yield exactly one charge for replayed confirms; an expired hold or lost booking race charges nothing because the charge lives inside the transaction that only commits on success.

UI: wallet balance in the nav header; confirm button labeled "Confirm — ₹25".

## Acceptance criteria

- [ ] Signup grants ₹500; balance visible in the app header
- [ ] Confirmed booking decrements the wallet to ₹475 with a payment (amount 25) recorded
- [ ] Balance < 25 → 402 naming the remaining balance; no reservation or payment written
- [ ] Cancelling a booking refunds ₹25
- [ ] Replayed confirm with the same Idempotency-Key charges exactly once (extends the existing idempotent-confirm spec)
- [ ] Expired hold or lost booking race leaves the balance untouched
- [ ] Direct book path charges identically to the hold→confirm path
- [ ] Coin-flip mock payment gateway removed/replaced by the wallet
- [ ] e2e specs at the existing HTTP seam cover all of the above
- [ ] Confirm button shows the price (manual)

## Blocked by

- 1Ayush-Petwal/Project-1#17 — same reservations-service choke points and spec files; sequential avoids conflicts
