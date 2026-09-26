#!/usr/bin/env bash
# psql inside the db container. Default role: db_migrator. scripts/psql.sh [role] [psql args...]
set -euo pipefail
cd "$(dirname "$0")/.."
role="${1:-db_migrator}"; shift || true
if [ "$role" = postgres ]; then
  exec docker compose exec -u postgres db psql -d reeldeal "$@"
fi
var="$(echo "$role" | tr '[:lower:]' '[:upper:]')_PASSWORD"
pw="$(grep -E "^${var}=" .env | cut -d= -f2-)"
exec docker compose exec -e PGPASSWORD="$pw" db psql -h 127.0.0.1 -U "$role" -d reeldeal "$@"
