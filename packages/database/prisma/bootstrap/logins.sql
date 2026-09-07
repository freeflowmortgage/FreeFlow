-- Executed by the RDS administrative login after capability roles exist.
-- Values arrive through psql variables and are quoted with PostgreSQL format().

SELECT format('CREATE ROLE %I LOGIN', :'migrator_username')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_username')
\gexec

SELECT format(
  'ALTER ROLE %I PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  :'migrator_username',
  :'migrator_password'
)
\gexec

SELECT format('GRANT freeflow_migrator TO %I', :'migrator_username')
\gexec

SELECT format('CREATE ROLE %I LOGIN', :'app_username')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_username')
\gexec

SELECT format(
  'ALTER ROLE %I PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  :'app_username',
  :'app_password'
)
\gexec

SELECT format('GRANT freeflow_app TO %I', :'app_username')
\gexec
