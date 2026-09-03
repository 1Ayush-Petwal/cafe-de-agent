# Cold slots get nudged

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/10](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/10) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

Slots gain a demand score, and cold ones are offered at a bounded discount rather than left to perish. A slot unsold at its start time is worth nothing to the café, so any revenue above marginal cost beats letting it expire.

The score combines historical fill rate for that café, weekday and hour with current hold pressure. Historical fill rate needs history, so the seed gains several weeks of past bookings weighted by hour and day from a fixed seed. Without that, every slot scores cold on a fresh database, everything gets discounted, and the mechanic becomes the margin-destruction machine it is supposed to avoid - with a negative revenue delta as the headline number.

When a requested slot is unavailable, or a cold slot exists inside the buyer's stated window, the agent proposes alternatives. Four guardrails, all required: the discount is capped as a fraction of price and never falls below the café owner's floor; hot slots are never discounted at any size; at most two alternatives are offered per request; and every candidate passes through the mandate preview before being offered, so an alternative the mandate would refuse is filtered out rather than proposed and then denied.

## Acceptance criteria

- [ ] Seed writes several weeks of past bookings, hour- and day-weighted, from a fixed seed
- [ ] Demand scores spread across slots rather than collapsing to a single value
- [ ] Cold slots are discounted; hot slots are never discounted
- [ ] The discount is capped as a fraction of price and floored by the café's setting
- [ ] At most two alternatives are offered per request
- [ ] An alternative the mandate would refuse is never proposed
- [ ] The agent offers an alternative when the requested slot is unavailable

## Blocked by

- #3
- #5
- #7

