#!/bin/sh
set -eu

required="PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD APP_USERNAME APP_PASSWORD MIGRATOR_USERNAME MIGRATOR_PASSWORD MIGRATOR_DATABASE_URL"
for name in $required; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Required migration environment variable is missing: $name" >&2
    exit 1
  fi
done

case "$PGDATABASE" in
  *[!A-Za-z0-9_]*)
    echo "PGDATABASE contains unsupported characters." >&2
    exit 1
    ;;
esac

: "${PGSSLMODE:=require}"
export PGSSLMODE

database_exists="$(psql --dbname=postgres --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'")"
if [ "$database_exists" != "1" ]; then
  createdb "$PGDATABASE"
fi

psql --dbname="$PGDATABASE" --set=ON_ERROR_STOP=1 \
  --file=/app/packages/database/prisma/bootstrap/roles.sql

psql --dbname="$PGDATABASE" --set=ON_ERROR_STOP=1 \
  --set=app_username="$APP_USERNAME" \
  --set=app_password="$APP_PASSWORD" \
  --set=migrator_username="$MIGRATOR_USERNAME" \
  --set=migrator_password="$MIGRATOR_PASSWORD" \
  --file=/app/packages/database/prisma/bootstrap/logins.sql

unset PGPASSWORD
export DATABASE_URL="$MIGRATOR_DATABASE_URL"
/app/packages/database/node_modules/.bin/prisma migrate deploy --schema=/app/packages/database/prisma/schema.prisma

if [ -n "${SEED_OIDC_SUBJECT:-}" ] || [ -n "${SEED_EMAIL:-}" ]; then
  if [ -z "${SEED_OIDC_SUBJECT:-}" ] || [ -z "${SEED_EMAIL:-}" ]; then
    echo "SEED_OIDC_SUBJECT and SEED_EMAIL must be supplied together." >&2
    exit 1
  fi
  psql "$MIGRATOR_DATABASE_URL" --set=ON_ERROR_STOP=1 \
    --set=oidc_subject="$SEED_OIDC_SUBJECT" \
    --set=user_email="$SEED_EMAIL" \
    --file=/app/packages/database/prisma/bootstrap/seed-live-test.sql
fi

echo "FreeFlow database migration completed successfully."
