#!/usr/bin/env bash
# Test only: turns a freshly migrated, empty test database into the new layout
# (`shared`, `mainnet`, `preprod`), so CI can run the suites on it. Never run it
# against a database that holds data, and never in production: the real move is
# the move script of the window pull request.
#
#   split-network-layout.sh <database-url>
#
# PSQL and PG_DUMP name the commands to run (default `psql` and `pg_dump`); CI
# runs them inside the PostgreSQL container, whose tools match the server.
#
# What it does, in this order:
# 1. Every table of `prisma/network-tables.json`'s Network list, and every enum
#    only those tables use, moves to a schema named `preprod` for now. Every
#    other table, view, enum, sequence and function moves to `shared`.
#    Extensions and `_prisma_migrations` stay in `public`. `SET SCHEMA` keeps
#    every index, constraint and trigger, and every foreign key, the ones that
#    cross between the schemas included.
# 2. `pg_dump` copies that Network schema's definition, then it is renamed
#    `mainnet`, so the shared tables' foreign keys point at Mainnet.
# 3. The copy is restored as `preprod`: the same tables, its own enums, and its
#    keys into `shared`; no shared table points at it.
#
# Left broken on purpose: function and trigger bodies that name `public.` or an
# unqualified table (ticket 19), and unqualified raw SQL (tickets 16 and 17).
set -euo pipefail

url=${1:?usage: split-network-layout.sh <database-url>}
read -r -a psql <<<"${PSQL:-psql}"
read -r -a pg_dump <<<"${PG_DUMP:-pg_dump}"

here=$(cd "$(dirname "$0")" && pwd)
network_tables=$(node -e '
  const list = require(process.argv[1]);
  console.log([...Object.values(list.network), ...list.networkJoinTables].join(","));
' "$here/../prisma/network-tables.json")

"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 -v network_tables="$network_tables" <<'SQL'
BEGIN;
SELECT set_config('split.network_tables', :'network_tables', true);
DO $$
DECLARE
  network text[] := string_to_array(current_setting('split.network_tables'), ',');
  object record;
BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('shared', 'mainnet', 'preprod')) THEN
    RAISE EXCEPTION 'the database already has a shared, mainnet or preprod schema';
  END IF;
  IF EXISTS (
    SELECT FROM unnest(network) AS listed(name)
    WHERE to_regclass(format('public.%I', name)) IS NULL
  ) THEN
    RAISE EXCEPTION 'a Network table of network-tables.json is not in public';
  END IF;
  CREATE SCHEMA shared;
  CREATE SCHEMA preprod;

  -- Enums go with the tables that use them; none is used on both sides.
  FOR object IN
    SELECT t.typname,
      bool_or(c.relname = ANY (network)) AS network,
      bool_or(c.relname <> ALL (network)) AS shared
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
    LEFT JOIN pg_attribute a ON a.atttypid IN (t.oid, t.typarray) AND a.attnum > 0
    LEFT JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'v', 'm')
    WHERE t.typtype = 'e'
    GROUP BY t.typname
  LOOP
    IF object.network AND object.shared THEN
      RAISE EXCEPTION 'enum % is used by a Network and a shared table', object.typname;
    END IF;
    EXECUTE format('ALTER TYPE public.%I SET SCHEMA %I', object.typname,
      CASE WHEN object.network THEN 'preprod' ELSE 'shared' END);
  END LOOP;

  -- Tables, views and sequences no column owns (owned ones follow the table).
  FOR object IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND c.relname <> '_prisma_migrations'
      AND NOT EXISTS (
        SELECT FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype IN ('a', 'e', 'i')
      )
  LOOP
    EXECUTE format('ALTER %s public.%I SET SCHEMA %I',
      CASE object.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      object.relname,
      CASE WHEN object.relname = ANY (network) THEN 'preprod' ELSE 'shared' END);
  END LOOP;

  -- Functions that no extension owns.
  FOR object IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE NOT EXISTS (
      SELECT FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
    )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET SCHEMA shared', object.signature);
  END LOOP;
END
$$;
COMMIT;
SQL

dump=$("${pg_dump[@]}" --schema-only --no-owner --no-privileges --schema=preprod "$url")
"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 -c 'ALTER SCHEMA preprod RENAME TO mainnet'
"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 <<<"$dump"
