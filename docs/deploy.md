# Deploy

One Render web service, one URL. It serves the built SPA and the API from the
same origin (`/api/*`), and runs the outbox/webhook/agent poll loops in-process
— see the comments in `render.yaml` and `apps/api/src/main.ts`.

## First deploy

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Fill the three secrets it prompts for (they are `sync: false`, so never
   committed): `DATABASE_URL` (Neon), `REDIS_URL` (Upstash, `rediss://…`),
   `GEMINI_API_KEY`.
4. Apply. The URL it hands back is the whole app.

Everything else — JWT secret, hold TTL, rate limits, cache TTL — is set in
`render.yaml` and matches the local `.env` defaults.

## Notes

- `synchronize: true` (`apps/api/src/config/typeorm.config.ts`) still generates
  the schema from entities on boot. That is fine while the deployed data is
  disposable; the first deploy carrying real bookings needs migrations instead.
- The free plan sleeps when idle, and the poll loops sleep with it — queued
  notifications and agent workflows stall until the next request wakes it.
  `render.yaml` asks for `starter` for that reason.
- Serverless (Vercel) is a poor fit here: two endpoints are SSE, each holding an
  open Redis subscriber connection, and the workers poll every second.
