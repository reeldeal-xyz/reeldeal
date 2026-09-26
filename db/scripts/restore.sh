#!/usr/bin/env bash
# Restore a dump into a scratch database and check it; never touches the live database.
#   scripts/restore.sh YYYY-MM-DD   dump from $DB_BACKUP_S3_URI
#   scripts/restore.sh latest       newest dump in the local backups volume
# Keeps the scratch database only with KEEP=1.
set -euo pipefail
cd "$(dirname "$0")/.."
which="${1:?usage: restore.sh YYYY-MM-DD|latest}"
scratch="restore_check"

if [ "$which" = latest ]; then
  file=$(docker compose exec -T db sh -c 'ls -1t /backups/*.dump | head -1')
else
  file="/backups/restore-$which.dump"
  docker compose run --rm --no-deps -T backup sh -c \
    'aws s3 cp --only-show-errors "${DB_BACKUP_S3_URI%/}/$1.dump" "$2"' _ "$which" "$file"
fi
echo "restore: $file -> $scratch"

pg() { docker compose exec -T -u postgres db "$@"; }
pg dropdb --if-exists "$scratch" 2>/dev/null
pg createdb -T template0 "$scratch"
pg pg_restore --exit-on-error -d "$scratch" "$file"
./scripts/test.sh "$scratch"

echo "restore: row counts (live vs restored)"
tables=$(pg psql -X -At -d "$scratch" -c "
  SELECT format('%I.%I', schemaname, tablename) FROM pg_tables
  WHERE schemaname IN ('geo','risk','app','dbmate') ORDER BY 1")
for t in $tables; do
  a=$(pg psql -X -At -d reeldeal -c "SELECT count(*) FROM $t" </dev/null)
  b=$(pg psql -X -At -d "$scratch" -c "SELECT count(*) FROM $t" </dev/null)
  printf '  %-32s %8s %8s\n' "$t" "$a" "$b"
done

[ "${KEEP:-}" = 1 ] || pg dropdb "$scratch"
[ "$which" = latest ] || docker compose exec -T db rm -f "$file"
echo "restore: ok"
