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
#    table, view and sequence of its shared list moves to `shared`, as do every
#    other enum and every function. Extensions and `_prisma_migrations` stay in
#    `public`. A table, view or sequence the list does not place stops it.
#    The functions of the list's `networkFunctions` go with the Network tables
#    instead of to `shared`; a trigger or CHECK stays bound to its function.
#    `SET SCHEMA` keeps every index, constraint and trigger, and every foreign
#    key, the ones that cross between the schemas included.
# 2. `pg_dump` copies that Network schema's definition, then it is renamed
#    `mainnet`, so the shared tables' foreign keys point at Mainnet.
# 3. The copy is restored as `preprod`: the same tables, its own enums, and its
#    keys into `shared`; no shared table points at it. It also gets its own
#    copy of the Network functions, and its triggers and CHECKs run that copy.
# 4. `prisma/network-layout/shared-trigger-bodies.sql` replaces the bodies of
#    the functions behind the triggers on shared tables, with every name given
#    its schema. Its guard refuses when a migration changed one of them since
#    its digest was recorded. `prisma/network-layout/network-trigger-bodies.sql`
#    does the same for the Network functions, once per Network: it is one
#    template, and each copy is that text with `@network@` replaced by the
#    schema's name, so the two cannot differ in anything else. Then, in the
#    same transaction: every function of `shared` is either one the file
#    replaced or, by its signature, on the list of functions that wait, and
#    every function of `mainnet` and `preprod` is one the template replaced.
#    So a migration that changes or adds a function fails here until the file,
#    the template or the list follows.
#
# After a failure, recreate the database: step 1, steps 2 and 3, and step 4 are
# three transactions.
#
# Left broken on purpose: function and trigger bodies that name `public.` or an
# unqualified table (ticket 19: the functions step 4 lists as waiting), and
# unqualified raw SQL (tickets 16 and 17).
set -euo pipefail

url=${1:?usage: split-network-layout.sh <database-url>}
read -r -a psql <<<"${PSQL:-psql}"
read -r -a pg_dump <<<"${PG_DUMP:-pg_dump}"

here=$(cd "$(dirname "$0")" && pwd)
# Comma-separated SQL names: the Network tables, then the shared objects.
# Then the Network functions' signatures, separated by `;`.
read -r network_tables shared_tables network_functions < <(node -e '
  const list = require(process.argv[1]);
  console.log(
    [...Object.values(list.network), ...list.networkJoinTables].join(","),
    [...Object.values(list.shared), ...list.sharedSqlOnly].join(","),
    list.networkFunctions.join(";"),
  );
' "$here/../prisma/network-tables.json")
[ -n "${network_functions:-}" ] || { echo "could not read network-tables.json" >&2; exit 1; }

"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 -v network_tables="$network_tables" -v shared_tables="$shared_tables" -v network_functions="$network_functions" <<'SQL'
BEGIN;
SELECT set_config('split.network_tables', :'network_tables', true);
SELECT set_config('split.shared_tables', :'shared_tables', true);
SELECT set_config('split.network_functions', :'network_functions', true);
DO $$
DECLARE
  network text[] := string_to_array(current_setting('split.network_tables'), ',');
  shared text[] := string_to_array(current_setting('split.shared_tables'), ',');
  network_functions text[] := string_to_array(current_setting('split.network_functions'), ';');
  network_function_oids oid[];
  unplaced text;
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
  SELECT string_agg(c.relname, ', ') INTO unplaced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
    AND c.relname <> '_prisma_migrations'
    AND c.relname <> ALL (network) AND c.relname <> ALL (shared)
    AND NOT EXISTS (
      SELECT FROM pg_depend d
      WHERE d.objid = c.oid AND d.deptype IN ('a', 'e', 'i')
    );
  IF unplaced IS NOT NULL THEN
    RAISE EXCEPTION 'network-tables.json places none of: %', unplaced;
  END IF;
  SELECT string_agg(name, ', ') INTO unplaced
  FROM unnest(network_functions) AS listed(name)
  WHERE to_regprocedure('public.' || name) IS NULL;
  IF unplaced IS NOT NULL THEN
    RAISE EXCEPTION 'no migration creates these networkFunctions of network-tables.json: %', unplaced;
  END IF;
  -- Resolved here: a signature that names an enum stops resolving in `public`
  -- once the enums have moved.
  network_function_oids := ARRAY(
    SELECT to_regprocedure('public.' || name)::oid FROM unnest(network_functions) AS listed(name)
  );
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
    LEFT JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p', 'v', 'm')
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
    SELECT p.oid::regprocedure AS signature, p.oid = ANY (network_function_oids) AS network
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.prokind = 'f' AND NOT EXISTS (
      SELECT FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
    )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET SCHEMA %I', object.signature,
      CASE WHEN object.network THEN 'preprod' ELSE 'shared' END);
  END LOOP;
END
$$;
COMMIT;
SQL

dump=$("${pg_dump[@]}" --schema-only --no-owner --no-privileges --schema=preprod "$url")
"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 --single-transaction \
  <<<"ALTER SCHEMA preprod RENAME TO mainnet;
$dump"

bodies="${here%/scripts}/prisma/network-layout/shared-trigger-bodies.sql"
network_bodies="${here%/scripts}/prisma/network-layout/network-trigger-bodies.sql"
{
  cat <<'SQL'
CREATE TEMP TABLE functions_before ON COMMIT DROP AS
SELECT oid, ctid AS row_version FROM pg_proc
WHERE pronamespace IN ('shared'::regnamespace, 'mainnet'::regnamespace, 'preprod'::regnamespace);
SQL
  cat "$bodies"
  sed 's/@network@/mainnet/g' "$network_bodies"
  sed 's/@network@/preprod/g' "$network_bodies"
  cat <<'SQL'
DO $check$
DECLARE
  shared_file CONSTANT text := 'packages/database/prisma/network-layout/shared-trigger-bodies.sql';
  network_file CONSTANT text := 'packages/database/prisma/network-layout/network-trigger-bodies.sql';
  file text;
  list CONSTANT text := 'the waiting list in packages/database/scripts/split-network-layout.sh';
  -- Functions the file does not replace yet.
  waiting CONSTANT text[] := ARRAY[
    -- Ticket 19 part 2: they read the Network named on the row (tickets 07 to 09).
    'shared.scope_notification_to_workspace_membership()',
    'shared.sync_history_from_task()',
    'shared.sync_history_from_task_event()',
    'shared.upsert_history_task(text)',
    'shared.history_task_amount(text)'
  ];
  gone text;
  fn record;
BEGIN
  SELECT string_agg(name, ', ') INTO gone
  FROM unnest(waiting) AS listed(name) WHERE to_regprocedure(name) IS NULL;
  IF gone IS NOT NULL THEN
    RAISE EXCEPTION 'no migration creates %: remove it from %', gone, list;
  END IF;

  FOR fn IN
    SELECT p.oid::regprocedure AS signature, b.oid IS NULL AS created,
      -- The file wrote the row: it is not the row of the snapshot.
      b.row_version IS DISTINCT FROM p.ctid AS in_file,
      EXISTS (SELECT FROM unnest(waiting) AS listed(name) WHERE to_regprocedure(name) = p.oid) AS waits,
      p.pronamespace = 'shared'::regnamespace AS shared
    FROM pg_proc p
    LEFT JOIN functions_before b ON b.oid = p.oid
    WHERE p.pronamespace IN ('shared'::regnamespace, 'mainnet'::regnamespace, 'preprod'::regnamespace)
  LOOP
    file := CASE WHEN fn.shared THEN shared_file ELSE network_file END;
    IF fn.created THEN
      RAISE EXCEPTION '% creates %, which no migration creates with that signature: update or remove it', file, fn.signature;
    ELSIF fn.in_file AND fn.waits THEN
      RAISE EXCEPTION 'function % is in % now: remove it from %', fn.signature, file, list;
    ELSIF NOT fn.in_file AND NOT fn.waits AND fn.shared THEN
      RAISE EXCEPTION 'function % has no body for the new layout: add it to % with its digest, or to % with the ticket it waits for. If a trigger or CHECK on a Network table runs it, add it to networkFunctions in packages/database/prisma/network-tables.json and to % instead',
        fn.signature, file, list, network_file;
    ELSIF NOT fn.in_file AND NOT fn.waits THEN
      -- A Network schema has no waiting list: a function is there because
      -- `networkFunctions` of network-tables.json names it.
      RAISE EXCEPTION 'function % has no body for the new layout: add it to % with its digest', fn.signature, file;
    END IF;
  END LOOP;
END
$check$;
SQL
} | "${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 --single-transaction || {
  echo "split-network-layout.sh: step 4 failed while applying or checking $bodies and $network_bodies" >&2
  exit 1
}
