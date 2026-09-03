# Refund a capture whose confirm failed

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/9](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/9) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

When a payment captures but the confirm that follows fails, the money is refunded and the outcome recorded.

The failure is not hypothetical and does not need to be staged: with the binding gate inside the confirm transaction, a concurrent booking exhausting the mandate while this buyer is at checkout produces a genuine capture-then-deny. A slot taken in the gap produces another. Injected failures supplement these rather than standing in for them.

The hold is consumed before the transaction opens, so a failed confirm has already freed the slot; compensation is refund-only.

The refund is issued inline. The crash window between transaction rollback and the refund call is explicitly marked in the code, naming the upgrade path - recording the capture durably before confirm and reclaiming stranded captures with a background sweeper - which is deliberately deferred. The gap is disclosed rather than hidden.

## Acceptance criteria

- [ ] A capture followed by a failed confirm issues a refund
- [ ] A compensate decision row is written carrying the failure reason
- [ ] The slot is bookable again afterwards
- [ ] The customer ends with no reservation and no net charge
- [ ] A mandate denial at confirm time after a successful capture follows the same path
- [ ] The crash window is marked in code with its upgrade path named

## Blocked by

- #6
- #8

