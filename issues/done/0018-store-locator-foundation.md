# Store locator foundation: café geo/cuisine/rating fields, filtered list API, map + card home page

> Local mirror of [1Ayush-Petwal/Project-1/issues/18](https://github.com/1Ayush-Petwal/Project-1/issues/18) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area D, foundation)

## What to build

The Starbucks-style store-locator home page for Delhi, end to end.

Café records gain latitude, longitude, region (default `delhi`), opening hour, closing hour, cuisines (Postgres text array — deliberately no join table), and rating + ratingCount (seeded plausible values). Delhi seed cafés get real coordinates. Owners can set their café's cuisines. The café list endpoint gains region, cuisine, and sort-by-rating parameters; the existing cache-aside café-list cache keeps storing the full unfiltered list, with filtering/sorting applied after the cache read (avoids cache-key explosion).

The home page becomes a card list beside an interactive Leaflet + OpenStreetMap map (react-leaflet — free, no API key, explicitly not Google Maps embed) with a pin per café. Each card shows name, area, distance from the user (haversine, client-side, from browser geolocation), open/closed status derived from hours, cuisines, and star rating. Each card has a Directions button opening the Google Maps universal directions URL (plain deep link). Clicking a pin highlights its card and vice versa. One search box instantly filters cafés by name or area as the user types (client-side). Location permission denied → distances simply omitted, page fully functional.

## Acceptance criteria

- [ ] Café list API filters by region and cuisine and sorts by rating; new café fields present in responses
- [ ] Cached-list behavior unchanged by filter params (filters apply post-cache-read)
- [ ] e2e specs at the existing HTTP seam cover list filtering/sorting and new fields
- [ ] Home page shows card list + map with pins for Delhi cafés (manual verification)
- [ ] Cards show name, area, distance, open/closed, cuisines, rating; Directions deep link works (manual)
- [ ] Pin↔card highlight both directions (manual)
- [ ] Search box live-filters by name/area (manual)
- [ ] Permission denied → no distances, no errors (manual)
- [ ] Owner can set cuisines from the dashboard

## Blocked by

None - can start immediately
