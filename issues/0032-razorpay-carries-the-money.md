# Razorpay carries the money

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/8](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/8) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

Real test-mode money replaces the wallet behind a provider switch, with exactly one of the two charging on any given booking.

Orders are created only after the gate has allowed the action, and carry the mandate, agent, user, hold and idempotency key in their notes, so the webhook can complete a booking while holding no server-side session state. The signed webhook is the source of truth for payment, not any client callback: a browser callback can be dropped, replayed or forged, and a signed webhook cannot. Its signature is verified against the raw request bytes before anything parses them.

The webhook and the agent's own confirm both invoke the existing confirm path with the same idempotency key. Whichever arrives first commits, and the second replays the stored outcome through machinery that already exists and is already covered by specs. This makes redelivery safe by construction, and means the agent gets a synchronous answer while the booking still commits if the agent disappears after capture.

The hold lifetime is raised so a hold survives intent creation, checkout and webhook delivery.

## Acceptance criteria

- [ ] Provider switch selects wallet or Razorpay; the two never both charge
- [ ] An order is created only after an allowing preview, carrying the required notes
- [ ] Signature verified against raw bytes before parsing; a wrong-secret payload is rejected
- [ ] A correctly signed capture event commits the booking
- [ ] The same event redelivered books exactly once
- [ ] The webhook and the agent's confirm racing on one key produce exactly one booking
- [ ] The payment record stores its Razorpay payment identifier, uniquely
- [ ] Hold lifetime raised in deployment config and example env
- [ ] The Razorpay client is injectable with a stub implementation selected by env, following the existing mock-gateway pattern

## Blocked by

- #3
- #5

Findings from the plumbing spike (#2) should be read first, but it is not a code dependency.

