#!/bin/sh
# Runs inside the official postgres image on FIRST initialization only
# (/docker-entrypoint-initdb.d). Creates the auth database in addition to the
# default $POSTGRES_DB (cv_database), which the entrypoint creates itself.
set -e

AUTH_DB="${AUTH_DB_NAME:-auth_db}"

echo "Creating additional database: ${AUTH_DB}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ${AUTH_DB}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${AUTH_DB}')\gexec
    GRANT ALL PRIVILEGES ON DATABASE ${AUTH_DB} TO "$POSTGRES_USER";
EOSQL
echo "Database ${AUTH_DB} ready"
