#!/usr/bin/env bash
# LOCAL ONLY: delete the local database volume and rebuild from scratch.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "${DB_DATA:-}" ] || grep -qE '^DB_DATA=' .env 2>/dev/null; then
  echo "refusing to reset: DB_DATA is set (server data directory)" >&2; exit 1
fi
docker compose down -v --remove-orphans
DB_LOCAL=1 ./scripts/up.sh
