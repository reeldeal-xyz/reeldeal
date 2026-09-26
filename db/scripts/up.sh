#!/usr/bin/env bash
# Start (or update) the database and bring it to the current schema. Idempotent; used locally and by deploy-db.yml.
#   1. shared network  2. db + backup up and healthy  3. bootstrap roles/grants  4. dbmate migrations  5. tests
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  if [ -n "${CI:-}" ] || [ "${DB_LOCAL:-}" = 1 ]; then cp .env.example .env
  else echo "db/.env is missing (copy .env.example and set real passwords)" >&2; exit 1; fi
fi

# On the server the data dir lives on the dedicated EBS volume; never let Docker create it on the root disk.
data="$(grep -E '^DB_DATA=' .env | cut -d= -f2- || true)"
if [ -n "$data" ] && [ "${data#/}" != "$data" ] && [ ! -d "$data" ]; then
  echo "DB_DATA=$data does not exist: is the data volume mounted?" >&2; exit 1
fi

docker network inspect reeldeal >/dev/null 2>&1 || docker network create reeldeal >/dev/null
docker compose up -d --build --wait --quiet-pull db backup
docker compose exec -T -u postgres db psql -X -q -Atc "SELECT pg_reload_conf()" >/dev/null
pending=$(docker compose exec -T -u postgres db psql -X -Atc "SELECT string_agg(name, ', ') FROM pg_settings WHERE pending_restart")
[ -z "$pending" ] || echo "up: restart needed for: $pending (docker compose restart db)" >&2
docker compose exec -T -u postgres db bash /db/bootstrap/bootstrap.sh
docker compose run --rm --quiet-pull migrate up
./scripts/test.sh
