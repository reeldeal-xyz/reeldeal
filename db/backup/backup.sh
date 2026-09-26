#!/bin/sh
# One dump: pg_dump -Fc as db_backup into /backups, then to $DB_BACKUP_S3_URI/<date>.dump if set.
# Keeps the last 3 dumps locally; S3 retention is a bucket lifecycle rule.
set -eu
name="${PGDATABASE}-$(date +%Y-%m-%dT%H%M).dump"
tmp="/backups/.${name}.partial"
pg_dump -Fc -f "$tmp"
mv "$tmp" "/backups/$name"
echo "backup: wrote /backups/$name ($(du -h "/backups/$name" | cut -f1))"
if [ -n "${DB_BACKUP_S3_URI:-}" ]; then
  aws s3 cp --only-show-errors "/backups/$name" "${DB_BACKUP_S3_URI%/}/$(date +%Y-%m-%d).dump"
  echo "backup: uploaded ${DB_BACKUP_S3_URI%/}/$(date +%Y-%m-%d).dump"
fi
ls -1t /backups/*.dump | tail -n +4 | xargs -r rm -f
