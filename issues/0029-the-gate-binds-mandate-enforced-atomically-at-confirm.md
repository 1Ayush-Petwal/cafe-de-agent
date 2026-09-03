# The gate binds: mandate enforced atomically at confirm

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/5](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/5) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

The mandate becomes enforceable, in two distinct places with deliberately different guarantees.

An advisory preview runs before any payment intent is created. It reads the ceilings, returns allow or deny with a specific reason, and writes nothing. A denied preview means no payment intent is ever created, so a doomed booking never becomes a payment that has to be unwound.

The binding check is a single conditional update that evaluates every ceiling in the same statement that increments the consumption counters, executed inside the transaction that already writes the reservation, payment and outbox rows. Zero rows affected is the denial, and it rolls the whole transaction back. There is no read-then-write anywhere in the path and no advisory lock: the database is the arbiter, and the verdict and the accounting are the same statement.

This overrules the source design document, which consumed budget at intent creation. That leaks budget permanently on any abandoned checkout, and its stated justification - that creating an order is the first irreversible act - is false, since nothing moves until capture.

## Acceptance criteria

- [ ] Preview returns allow or deny with a reason and mutates nothing
- [ ] The binding check and the budget spend are one statement, inside the existing booking transaction
- [ ] Each ceiling, plus locality mismatch, window mismatch, expiry, revocation and exhaustion, produces its own distinct deny reason
- [ ] A denied confirm rolls back completely: no reservation, no payment, no consumption
- [ ] Parallel confirms against a mandate with headroom for fewer than all of them never breach the ceiling, and exactly the affordable number succeed
- [ ] An abandoned payment intent consumes no budget
- [ ] Verdicts are binary; no step-up band is introduced

## Blocked by

- #4

