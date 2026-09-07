-- Executed by the RDS administrative login after capability roles exist.
-- Values arrive through psql variables and are quoted with PostgreSQL format().

SELECT format('CREATE ROLE %I LOGIN', :'migrator_username')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_username')
\gexec

SELECT format(
  'ALTER ROLE %I PASSWORD %L NOCREATEDB NOCREATEROLE INHERIT',
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
  'ALTER ROLE %I PASSWORD %L NOCREATEDB NOCREATEROLE INHERIT',
  :'app_username',
  :'app_password'
)
\gexec

SELECT format('GRANT freeflow_app TO %I', :'app_username')
\gexec

-- Fail closed if a pre-existing login has any capability that the RDS role
-- administrator cannot safely revoke. The denominator becomes zero unless
-- exactly two restricted LOGIN roles match the expected contract.
SELECT 1 / CASE
  WHEN count(*) = 2 AND bool_and(
    rolcanlogin
    AND NOT rolsuper
    AND NOT rolcreatedb
    AND NOT rolcreaterole
    AND NOT rolreplication
    AND NOT rolbypassrls
  ) THEN 1
  ELSE 0
END AS restricted_login_roles_verified
FROM pg_roles
WHERE rolname IN (:'migrator_username', :'app_username');
