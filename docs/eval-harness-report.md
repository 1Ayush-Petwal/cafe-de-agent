# Evaluation harness — two arms, one demand

Generated 2026-09-05T15:57:00.513Z from a fixed seed (20260905), 30 synthetic buyer intents per arm — one synthetic buyer per intent, both arms facing identical demand (apps/api/scripts/eval-harness.ts).

| Metric | Baseline (exact-match) | Agent (slot-fill + mandate gate) |
|---|---|---|
| Slot fill rate | 80.0% | 83.3% |
| Gross revenue | ₹9040.00 | ₹9440.00 |
| Revenue per filled slot | ₹376.67 | ₹377.60 |
| Mandate denials | 0 | 4 (window_mismatch: 2, locality_mismatch: 2) |
| Platform denials | 4 (slot_unavailable: 4) | 0 |
| Over-refusal rate (mandate denials only) | 0.0% | 13.3% |
| Compensations ok / failed | 2 / 0 | 1 / 0 |

Double bookings under concurrent retry: **0**.

## Reading the numbers

- Both arms are driven by the exact same fixed-seed intent generator (`scripts/harness/intents.ts`) — the fill-rate and revenue deltas above are attributable to the slot-fill mechanic and the mandate gate, not to different demand.
- The baseline arm never calls the alternatives endpoint and carries no mandate — an unavailable requested slot is simply a lost booking. The agent arm proposes a mandate-screened alternative when the requested slot is unavailable, and every action (order creation) is gated by a mandate.
- **Mandate denials and platform denials are counted separately** — the over-refusal rate above counts mandate denials only, never a pre-existing platform rule (an unavailable slot, a race lost to another booking), per the PRD.
- Compensations are genuine capture-then-deny races (a slot taken in the gap between order creation and webhook delivery), not a mocked failure — ~5% of intents are deliberately raced this way; `compensations.failed` must be zero for the compensation path to be considered proven.
- Razorpay is stubbed at the client boundary only: order creation returns a synthetic id, and every capture is a self-signed `payment.captured` payload posted to the real webhook route — signature verification, `confirmHold`, the mandate consume, the booking write and the outbox are all the same code the demo runs.
