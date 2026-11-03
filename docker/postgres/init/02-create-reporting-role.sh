#!/bin/sh
# Runs once, when the postgres volume is first initialised. Table-level SELECT grants are applied
# by the API migration that follows the schema, since the tables do not exist yet at this point.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v password="$REPORTING_DB_PASSWORD" <<'EOSQL'
CREATE ROLE reporting_reader LOGIN PASSWORD :'password';
-- Belt and braces: even an accidental write from the reporting service is rejected.
ALTER ROLE reporting_reader SET default_transaction_read_only = on;
EOSQL
