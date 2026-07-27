# PWA: installable app shell, network-first data

> Local mirror of [1Ayush-Petwal/Project-1/issues/20](https://github.com/1Ayush-Petwal/Project-1/issues/20) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area E, PWA)

## What to build

Make the existing web app installable as a PWA — the PWA *is* the web app, one codebase, no switch. Add vite-plugin-pwa with a manifest (name, icons, theme colors) and a service worker that precaches the app shell only. All API data stays network-first: no offline availability and no offline booking, because availability is live (SSE + 90-second holds) and a stale cache would show bookable tables that aren't.

## Acceptance criteria

- [ ] App is installable to the home screen and opens standalone (manual, mobile browser)
- [ ] App shell loads offline; data screens show a network-required state rather than stale data (manual)
- [ ] API responses are never served from the service worker cache
- [ ] Production build emits a valid manifest + service worker; dev workflow unaffected
- [ ] Frontend verified manually (no web test runner — per PRD testing decisions)

## Blocked by

None - can start immediately
