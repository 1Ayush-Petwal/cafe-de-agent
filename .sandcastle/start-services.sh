#!/usr/bin/env bash
# Per-sandbox Postgres + Redis.
#
# Each agent gets its own database rather than sharing a hosted one: the e2e
# specs TRUNCATE 13 tables between tests, so concurrent pipelines against one
# database would destroy each other's fixtures.
#
# Credentials deliberately mirror docker-compose.yml (user/password `cafe`,
# port 5432, redis 6379) so the defaults in test/global-setup.ts and
# test/env.setup.ts resolve with no env overrides at all. Debian ships
# Postgres 15 rather than compose's 16; nothing the suite uses differs.
#
# Idempotent: re-running against already-started services is a no-op, but a
# genuine failure still aborts rather than being swallowed.
set -euo pipefail

export PATH="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1):$PATH"
PGDATA="${PGDATA:-$HOME/pgdata}"

[ -d "$PGDATA" ] || initdb -D "$PGDATA" -A trust -U cafe >/dev/null

# unix_socket_directories must move off the default /var/run/postgresql: the
# container runs as an unprivileged user that cannot write there, and the
# resulting lock-file failure kills startup with a misleading generic error.
pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || \
  pg_ctl -D "$PGDATA" \
    -o "-c listen_addresses=127.0.0.1 -p 5432 -c unix_socket_directories=/tmp" \
    -l "$HOME/pg.log" -w start >/dev/null

psql -U cafe -h 127.0.0.1 -d postgres -tAc \
  "select 1 from pg_database where datname='cafe_de_app'" | grep -q 1 || \
  createdb -U cafe -h 127.0.0.1 cafe_de_app

redis-cli ping >/dev/null 2>&1 || \
  redis-server --daemonize yes --save '' --appendonly no >/dev/null

node apps/api/scripts/wait-for-postgres.js
node apps/api/scripts/wait-for-redis.js
