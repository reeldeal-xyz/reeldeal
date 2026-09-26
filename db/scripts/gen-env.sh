#!/usr/bin/env bash
# Server one-time: write db/.env with random passwords. Refuses to overwrite.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env ] && { echo "db/.env already exists" >&2; exit 1; }
umask 077
{
  echo "POSTGRES_DB=reeldeal"
  for v in POSTGRES DB_MIGRATOR PIPELINE APP_MIGRATOR APP READONLY DB_BACKUP; do
    echo "${v}_PASSWORD=$(openssl rand -hex 24)"
  done
  echo "DB_PORT=5432"
  echo "DB_DATA=${DB_DATA:-/srv/pgdata/postgres}"
  echo "DB_BACKUP_S3_URI=${DB_BACKUP_S3_URI:?set DB_BACKUP_S3_URI}"
} > .env
echo "wrote db/.env"
