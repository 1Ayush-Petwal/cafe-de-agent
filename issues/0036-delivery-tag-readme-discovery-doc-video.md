# Delivery: tag, README, discovery doc, video

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/12](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/12) - GitHub is the source of truth. Label: `ready-for-human`, `Sandcastle`.

## Parent

#1

## What to build

Tag the substrate commit so the split between prior work and buildathon work is mechanical rather than asserted, and the log range between tag and head is exactly the new work.

Write the README above the fold: the thesis, the substrate versus built-this-week split, the architecture, and the harness numbers. Serve the agent-readable catalog discovery document if time allows, described as what it is, without claiming conformance to a specification that cannot be cited.

Do not squash-import into a fresh repository. That would delete the dated milestone commits the provenance claim rests on, and this repository already carries the full history and records the original as an upstream remote, which is strictly stronger.

Record the video.

## Acceptance criteria

- [ ] Substrate commit tagged, and the log range between tag and head is exactly the buildathon work
- [ ] README carries thesis, substrate and new split, architecture, and the numbers table
- [ ] Known gaps disclosed: inline refund crash window, stubbed harness payments, shared demand seed, mandate write hotspot
- [ ] Discovery document served, with no unverifiable specification-conformance claim
- [ ] Video recorded

## Blocked by

- #11

