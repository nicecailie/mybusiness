#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password APP_DB_PASSWORD
SELECT format('CREATE ROLE mybusiness_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', :'app_password') \gexec
SQL
