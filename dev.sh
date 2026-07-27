#!/bin/bash
set -eo pipefail
cd "$(dirname "$0")"

# DB + Redis are cloud-hosted (Neon/Upstash) via apps/api/.env.
# Tests still spin up local Docker themselves (see apps/api "test" script).
trap 'kill 0' EXIT
# The outbox/webhook/agent loops run inside the API process (see
# apps/api/src/main.ts) — `npm run dev:worker` is only for testing the
# split-out worker deploy.
npm run dev:api &
npm run dev:web &
wait
