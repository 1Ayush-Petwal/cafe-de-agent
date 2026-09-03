# Two arms, one demand, real numbers

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/11](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/11) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

A batch harness runs the same fixed synthetic demand through two arms and reports what changed. The baseline arm books exact matches only: requested slot unavailable means no booking. The agent arm has the slot-fill mechanic active and every action mandate-gated.

Each intent gets its own synthetic buyer, so the platform's existing one-booking-per-café-per-window rule never binds and the fill rate measures the mechanic rather than that rule.

Razorpay is stubbed at the client boundary, not below it. Order creation returns a synthetic identifier, and the harness self-signs capture events into the real webhook route, so everything from signature verification downward is the same code the demo runs. Paying dozens of real test orders requires interactive checkout and is not achievable headlessly.

Mandate denials and platform denials are counted separately, and over-refusal counts mandate denials only. Folding pre-existing booking rules into over-refusal would corrupt the one metric worth reporting.

## Acceptance criteria

- [ ] A fixed-seed generator produces identical intents on every run
- [ ] One synthetic buyer per intent
- [ ] Both arms consume identical demand
- [ ] Razorpay stubbed at the client boundary, with capture events self-signed into the real webhook route
- [ ] Reports fill rate, gross revenue, revenue per slot, denials by reason, over-refusal rate and compensations
- [ ] Mandate denials and platform denials are counted separately
- [ ] Injected confirm failures after capture all compensate cleanly
- [ ] Double bookings asserted to be zero under concurrent retry, as a test rather than a script
- [ ] Output written as JSON and as a Markdown table

## Blocked by

- #8
- #10

