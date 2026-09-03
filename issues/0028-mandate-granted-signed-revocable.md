# Mandate granted, signed, revocable

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/4](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/4) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

A mandate is a human's grant of bounded authority to an agent: ceilings on per-booking spend, total spend and booking count, a list of allowed localities, and a validity window that the booked slot must fall inside. The constraints are frozen and signed by the server at grant time. Consumption counters live on the same record but outside the signature, so spending never invalidates it.

The signature is a non-repudiation record proving which bounds the human agreed to. It is never accepted as a credential.

This slice creates, reads and revokes mandates. It enforces nothing yet.

## Acceptance criteria

- [ ] Grant endpoint creates a mandate and returns it with a server-computed signature
- [ ] The signature covers the constraints only; consumption counters are excluded from it
- [ ] Status endpoint returns remaining budget, remaining bookings and expiry
- [ ] Revoke endpoint moves the mandate to a revoked state with a timestamp
- [ ] A mandate is scoped to the granting user; another user can neither read nor revoke it
- [ ] Presenting a signature as authentication is rejected
- [ ] Minimal grant form in the web app (manual)

## Blocked by

- #3

