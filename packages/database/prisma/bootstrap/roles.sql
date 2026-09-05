-- Run once per database as the RDS administrative login before Prisma migrations.
-- These are NOLOGIN capability roles. IaC creates unique LOGIN roles and grants
-- them only the matching capability role.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freeflow_owner') THEN
    CREATE ROLE freeflow_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freeflow_migrator') THEN
    CREATE ROLE freeflow_migrator;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freeflow_app') THEN
    CREATE ROLE freeflow_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freeflow_worker') THEN
    CREATE ROLE freeflow_worker;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freeflow_readonly') THEN
    CREATE ROLE freeflow_readonly;
  END IF;
END
$roles$;

ALTER ROLE freeflow_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE freeflow_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE freeflow_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE freeflow_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE freeflow_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;

GRANT freeflow_owner TO freeflow_migrator;

DO $database_grants$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO freeflow_owner, freeflow_migrator, freeflow_app, freeflow_worker, freeflow_readonly',
    current_database()
  );
  EXECUTE format(
    'GRANT CREATE ON DATABASE %I TO freeflow_owner, freeflow_migrator',
    current_database()
  );
END
$database_grants$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO freeflow_owner, freeflow_migrator;
GRANT USAGE ON SCHEMA public TO freeflow_app, freeflow_worker, freeflow_readonly;
