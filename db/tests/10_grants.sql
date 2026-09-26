-- The role/grant matrix (README §5). Checks privileges only; writes nothing.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  t record;
BEGIN
  -- Only the owners can create objects in their schemas.
  ASSERT NOT has_schema_privilege('pipeline', 'geo', 'CREATE'), 'pipeline must not have DDL on geo';
  ASSERT NOT has_schema_privilege('pipeline', 'risk', 'CREATE'), 'pipeline must not have DDL on risk';
  ASSERT NOT has_schema_privilege('app', 'app', 'CREATE'), 'app must not have DDL on app';
  ASSERT NOT has_schema_privilege('app_migrator', 'geo', 'CREATE'), 'app_migrator must not have DDL on geo';
  ASSERT has_schema_privilege('app_migrator', 'app', 'CREATE'), 'app_migrator owns app';
  ASSERT NOT has_schema_privilege('readonly', 'geo', 'CREATE'), 'readonly must not have DDL';
  ASSERT NOT has_schema_privilege('pipeline', 'public', 'CREATE'), 'nobody creates in public';

  -- The pipeline can't see the app schema at all; the app never writes geo/risk.
  ASSERT NOT has_schema_privilege('pipeline', 'app', 'USAGE'), 'pipeline must not use app';
  ASSERT NOT has_schema_privilege('pipeline', 'drizzle', 'USAGE'), 'pipeline must not use drizzle';

  FOR t IN
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_tables WHERE schemaname IN ('geo', 'risk')
  LOOP
    ASSERT has_table_privilege('pipeline', t.name, 'SELECT,INSERT,UPDATE'), 'pipeline writes ' || t.name;
    ASSERT NOT has_table_privilege('pipeline', t.name, 'DELETE'), 'pipeline must retire, not delete: ' || t.name;
    ASSERT NOT has_table_privilege('pipeline', t.name, 'TRUNCATE'), 'pipeline must not truncate ' || t.name;
    ASSERT has_table_privilege('app', t.name, 'SELECT'), 'app reads ' || t.name;
    ASSERT NOT has_table_privilege('app', t.name, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'app must not write ' || t.name;
    ASSERT has_table_privilege('readonly', t.name, 'SELECT'), 'readonly reads ' || t.name;
    ASSERT NOT has_table_privilege('readonly', t.name, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'readonly writes ' || t.name;
    ASSERT has_table_privilege('db_backup', t.name, 'SELECT'), 'db_backup reads ' || t.name;
    ASSERT NOT has_table_privilege('db_backup', t.name, 'INSERT,UPDATE,DELETE'), 'db_backup writes ' || t.name;
  END LOOP;

  -- app tables (created later by Drizzle): app has DML, pipeline and readonly have nothing by default.
  FOR t IN
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_tables WHERE schemaname = 'app'
  LOOP
    ASSERT has_table_privilege('app', t.name, 'SELECT,INSERT,UPDATE,DELETE'), 'app writes ' || t.name;
    ASSERT NOT has_table_privilege('pipeline', t.name, 'SELECT'), 'pipeline must not read ' || t.name;
  END LOOP;

  -- Cross-schema references the app is allowed to make.
  ASSERT has_table_privilege('app_migrator', 'geo.plots', 'REFERENCES'), 'app_migrator references geo.plots';
  ASSERT has_table_privilege('app_migrator', 'risk.models', 'REFERENCES'), 'app_migrator references risk.models';

  -- Superuser is socket-only; no other role is privileged.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('db_migrator', 'pipeline', 'app_migrator', 'app', 'readonly', 'db_backup')
      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)
  ), 'client roles must not be privileged';
END $$;

-- The schema version table is readable by clients.
SET ROLE pipeline;
SELECT count(*) >= 0 AS ok FROM dbmate.schema_migrations \gset
RESET ROLE;

ROLLBACK;
\echo 10_grants ok
