#!/usr/bin/env bash
# Throwaway PostGIS for the database tests (tests/db/): the same bootstrap (roles, grants) and dbmate migrations as
# production, connected to as the `pipeline` role.
#   scripts/testdb.sh up     start it and print the export line for PIPELINE_TEST_DATABASE_URL
#   scripts/testdb.sh down   remove it
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

name=pipeline-testdb
port=${PIPELINE_TESTDB_PORT:-55432}
pw=test

case "${1:-up}" in
down)
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit 0
  ;;
up) ;;
*)
  echo "usage: $0 up|down" >&2
  exit 2
  ;;
esac

docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -p "127.0.0.1:$port:5432" \
  -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB=reeldeal postgis/postgis:16-3.4 >/dev/null
# The image runs its init scripts on a temporary server, then restarts; wait for the final one.
until docker logs "$name" 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 0.5; done
until docker exec "$name" pg_isready -U postgres -d reeldeal -q 2>/dev/null; do sleep 0.5; done

docker cp db/bootstrap/bootstrap.sh "$name:/bootstrap.sh"
docker exec -e POSTGRES_DB=reeldeal \
  -e DB_MIGRATOR_PASSWORD="$pw" -e PIPELINE_PASSWORD="$pw" -e APP_MIGRATOR_PASSWORD="$pw" \
  -e APP_PASSWORD="$pw" -e READONLY_PASSWORD="$pw" -e DB_BACKUP_PASSWORD="$pw" \
  "$name" bash /bootstrap.sh >/dev/null

for f in db/migrations/*.sql; do
  # dbmate runs the `-- migrate:up` section as db_migrator, the owner of geo and risk.
  { echo "SET ROLE db_migrator;"; awk '/^-- migrate:up/{on=1; next} /^-- migrate:down/{on=0} on' "$f"; } |
    docker exec -i "$name" psql -U postgres -d reeldeal -q -v ON_ERROR_STOP=1 >/dev/null
done

echo "export PIPELINE_TEST_DATABASE_URL=postgresql://pipeline:$pw@127.0.0.1:$port/reeldeal"
