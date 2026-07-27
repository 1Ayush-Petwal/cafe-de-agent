# Day/dinner themes: CSS variables, clock-based switch, sun/moon override

> Local mirror of [1Ayush-Petwal/Project-1/issues/23](https://github.com/1Ayush-Petwal/Project-1/issues/23) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area F)

## What to build

Two visual themes matching the approved Dalkom reference images: a warm cream/gold day theme and a dark brown/amber dinner theme. Implemented as CSS custom properties keyed off a root data-theme attribute — no theming library. The theme switches automatically by the user's clock (day 06:00–17:00 local, dinner otherwise); a small sun/moon toggle overrides the automatic choice and the override persists in localStorage, winning over the clock. Both themes apply consistently across the locator, booking/table-picker, reservations and agent screens.

## Acceptance criteria

- [ ] Day theme (cream/gold) active 06:00–17:00 local; dinner theme (dark amber) otherwise (manual)
- [ ] Sun/moon toggle overrides the clock; choice persists across reloads (manual)
- [ ] Locator, table-picker, reservations and agent screens all fully themed in both palettes — no half-styled screens (manual)
- [ ] Palettes match the Breakfast/Dinner reference images (manual)
- [ ] No new dependencies — CSS custom properties + data-theme only

## Blocked by

- 1Ayush-Petwal/Project-1#18 — themes go over the new locator UI
- 1Ayush-Petwal/Project-1#19 — themes go over the new table-picker UI
