# Locality search + sort modes: Nominatim geocoding, measuring-from chip, distance/cuisine toggle

> Local mirror of [1Ayush-Petwal/Project-1/issues/22](https://github.com/1Ayush-Petwal/Project-1/issues/22) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area D, search & sort)

## What to build

Locality search and sort modes on the store locator.

Geocoding: a new small geo module exposing one endpoint (locality query → coordinates + display name) wrapping Nominatim, OpenStreetMap's free geocoder. Queries are bounded to a Delhi bounding box, results cached in Redis with a long TTL, and calls proxied through our API to respect Nominatim's 1 req/sec policy. The Nominatim client is an injectable service so tests stub it via DI override (the established mock-gateway pattern — no live network in tests). Geocoding fires only on explicit selection, never per keystroke.

Search box: the locator's single combined input keeps its instant client-side name/area filtering; the last result row is always "search *«text»* as a locality," which triggers the geocode. When a locality resolves: the map re-centers, a dismissable "Measuring from: X" chip appears, every card's distance recomputes from that point, and the list re-sorts nearest-first — re-sort only, no radius filtering, no café hidden. Clearing the chip returns to GPS-based distances. Unresolvable locality → "area not found," view unchanged.

Sort modes: a segmented Distance/Cuisine toggle, mutually exclusive. Distance mode hides cuisine chips and sorts nearest-first from the active origin (GPS or locality). Cuisine mode shows cuisine chips (Italian, Continental, Asian, …) and sorts the filtered cuisine best-rated first. All client-side state — the café list is already fully loaded.

## Acceptance criteria

- [ ] Geocode endpoint resolves a Delhi locality to coordinates + display name; results Redis-cached (cache hit skips the upstream call); unknown locality → not-found shape
- [ ] e2e specs at the existing HTTP seam with the Nominatim client DI-stubbed
- [ ] "Search as locality" row triggers geocode; map re-centers; "Measuring from" chip appears; distances recompute and list re-sorts (manual)
- [ ] Chip dismissal restores GPS-based distances (manual)
- [ ] "Area not found" message on unresolvable locality; view unchanged (manual)
- [ ] Distance/Cuisine toggle: distance mode nearest-first from active origin; cuisine mode shows chips and sorts best-rated first (manual)
- [ ] No radius filtering — all cafés remain listed in every mode

## Blocked by

- 1Ayush-Petwal/Project-1#18 — needs the locator page, café coordinates, cuisines and ratings
