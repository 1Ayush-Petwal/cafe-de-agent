# Agent books under a mandate

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/7](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/7) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

The first-party agent becomes the mandate-bound buyer. A conversation can carry a mandate. Spending inside its bounds proceeds without the per-action approval prompt, which is the entire value of granting one over the existing dialog.

Spending the preview denies is refused outright, and the refusal is returned to the model as a structured result carrying the verdict, the reason and the remaining headroom, so the agent explains it in the conversation rather than retrying blindly. The agent also gains a tool to read its own remaining headroom, and is instructed to check it before proposing: compliance should be cheaper than violation.

Conversations without a mandate keep the existing approval behaviour exactly as it is. A human booking directly in the UI is deliberately unbounded by any mandate, because a mandate bounds delegated authority, not the account holder's own money.

## Acceptance criteria

- [ ] A conversation can be started with a mandate attached
- [ ] Spend inside the mandate completes without parking for approval
- [ ] Spend the preview denies is refused, with the reason surfaced in the conversation
- [ ] The agent can query its own remaining headroom as a tool call
- [ ] A conversation with no mandate behaves exactly as it did before
- [ ] Booking directly in the UI is unaffected by any mandate
- [ ] Remaining headroom visible in the chat (manual)

## Blocked by

- #5

