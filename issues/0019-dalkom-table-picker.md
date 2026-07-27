# Dalkom table-picker: table cards with capacity, slot/date pills, Reserve CTA

> Local mirror of [1Ayush-Petwal/Project-1/issues/19](https://github.com/1Ayush-Petwal/Project-1/issues/19) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area E, booking redesign)

## What to build

Redesign the booking screen to the approved Dalkom table-picker: each table rendered as a card with its label and seat capacity (e.g. "B1 · 4 seats") and a Reserved badge when taken; time slots and dates as tappable pills; a single "Reserve a Table" CTA. The CTA drives the existing hold → countdown → confirm flow unchanged. Capacity is already in the availability API response — this is UI-only, no backend change. Desktop renders the same components in a wider layout (one codebase, no separate mobile app). Live SSE availability refresh keeps working.

## Acceptance criteria

- [ ] Tables render as cards with capacity; taken tables show a Reserved badge
- [ ] Slot pills + date pills + single Reserve CTA replace the grid-of-buttons layout
- [ ] Hold countdown and confirm flow work exactly as before (hold banner, expiry, idempotent confirm)
- [ ] SSE-driven availability updates still refresh the view
- [ ] Desktop shows the same components in a wider layout
- [ ] No backend changes; existing e2e specs untouched and passing
- [ ] Frontend verified manually against the Dalkom reference images

## Blocked by

None - can start immediately
