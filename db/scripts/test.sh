#!/usr/bin/env bash
# Run db/tests/*.sql against a database (default: the live one). Every test rolls back.
#   scripts/test.sh [database]
set -euo pipefail
cd "$(dirname "$0")/.."
db="${1:-}"
for f in tests/*.sql; do
  docker compose exec -T -u postgres db sh -c \
    'PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "${1:-$POSTGRES_DB}" -f "/db/$2"' _ "$db" "$f"
done
