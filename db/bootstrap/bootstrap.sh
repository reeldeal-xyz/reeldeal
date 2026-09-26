#!/usr/bin/env bash
# Cluster-level setup that migrations can't do: extensions, roles, schema owners and grants (README §5).
# Idempotent. Runs as postgres over the local socket: once from init/ on an empty data dir, and again on
# every deploy (scripts/up.sh) so role passwords and grants follow db/.env and this file.
set -euo pipefail

PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -X -q -U postgres -d "${POSTGRES_DB:-reeldeal}" \
  -v db="${POSTGRES_DB:-reeldeal}" \
  -v pw_db_migrator="$DB_MIGRATOR_PASSWORD" \
  -v pw_pipeline="$PIPELINE_PASSWORD" \
  -v pw_app_migrator="$APP_MIGRATOR_PASSWORD" \
  -v pw_app="$APP_PASSWORD" \
  -v pw_readonly="$READONLY_PASSWORD" \
  -v pw_db_backup="$DB_BACKUP_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Roles. LOGIN roles get their password from db/.env on every run.
SELECT format('CREATE ROLE %I LOGIN', r)
FROM unnest(ARRAY['db_migrator', 'pipeline', 'app_migrator', 'app', 'readonly', 'db_backup']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

ALTER ROLE db_migrator  PASSWORD :'pw_db_migrator';
ALTER ROLE pipeline     PASSWORD :'pw_pipeline';
ALTER ROLE app_migrator PASSWORD :'pw_app_migrator';
ALTER ROLE app          PASSWORD :'pw_app';
ALTER ROLE readonly     PASSWORD :'pw_readonly';
ALTER ROLE db_backup    PASSWORD :'pw_db_backup';

GRANT pg_read_all_data TO db_backup;

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO db_migrator, pipeline, app_migrator, app, readonly, db_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Schemas. db_migrator (dbmate) owns geo/risk and the migrations table. app_migrator (Drizzle) creates
-- its own: web/drizzle's first migration runs `CREATE SCHEMA "app"`, and Drizzle keeps its bookkeeping
-- in `drizzle`. So app_migrator may create schemas, and everything it creates is owned by it.
CREATE SCHEMA IF NOT EXISTS geo     AUTHORIZATION db_migrator;
CREATE SCHEMA IF NOT EXISTS risk    AUTHORIZATION db_migrator;
CREATE SCHEMA IF NOT EXISTS dbmate  AUTHORIZATION db_migrator;
GRANT CREATE ON DATABASE :"db" TO app_migrator;

GRANT USAGE ON SCHEMA geo, risk, dbmate TO pipeline, app_migrator, app, readonly;

-- geo/risk: pipeline reads and writes (no DELETE: retire rows instead); everyone else reads.
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA geo, risk
  GRANT SELECT, INSERT, UPDATE ON TABLES TO pipeline;
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA geo, risk
  GRANT SELECT ON TABLES TO app, readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA geo, risk
  GRANT USAGE, SELECT ON SEQUENCES TO pipeline;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA geo, risk TO pipeline;
GRANT SELECT ON ALL TABLES IN SCHEMA geo, risk TO app, readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA geo, risk TO pipeline;

-- Clients check the schema version they need.
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA dbmate
  GRANT SELECT ON TABLES TO pipeline, app_migrator, app, readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA dbmate TO pipeline, app_migrator, app, readonly;

-- app: the app role gets DML on whatever Drizzle creates (the app schema doesn't exist until its first
-- migration, so these defaults aren't tied to a schema). readonly gets nothing by default; app_migrator
-- grants it non-PII views explicitly (README §4.3).
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator GRANT USAGE ON SCHEMAS TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator
  GRANT USAGE, SELECT ON SEQUENCES TO app;
SELECT format('GRANT USAGE ON SCHEMA %1$I TO app; '
              'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %1$I TO app; '
              'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %1$I TO app', nspname)
FROM pg_namespace WHERE nspname IN ('app', 'drizzle') \gexec
SQL

echo "bootstrap: roles, schemas and grants applied"
