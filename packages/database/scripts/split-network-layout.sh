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
#    `SET SCHEMA` keeps every index, constraint and trigger, and every foreign
#    key, the ones that cross between the schemas included.
# 2. `pg_dump` copies that Network schema's definition, then it is renamed
#    `mainnet`, so the shared tables' foreign keys point at Mainnet.
# 3. The copy is restored as `preprod`: the same tables, its own enums, and its
#    keys into `shared`; no shared table points at it.
# 4. `prisma/network-layout/shared-trigger-bodies.sql` replaces the bodies of
#    the functions behind the triggers on shared tables, with every name given
#    its schema. Its guard refuses when a migration changed one of them since
#    its digest was recorded. Then, in the same transaction: every function of
#    `shared` is either one the file replaced or, by its signature, on the
#    list of functions that wait. So a migration that changes or adds a
#    function fails here until the file or the list follows.
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
read -r network_tables shared_tables < <(node -e '
  const list = require(process.argv[1]);
  console.log(
    [...Object.values(list.network), ...list.networkJoinTables].join(","),
    [...Object.values(list.shared), ...list.sharedSqlOnly].join(","),
  );
' "$here/../prisma/network-tables.json")
[ -n "${shared_tables:-}" ] || { echo "could not read network-tables.json" >&2; exit 1; }

"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 -v network_tables="$network_tables" -v shared_tables="$shared_tables" <<'SQL'
BEGIN;
SELECT set_config('split.network_tables', :'network_tables', true);
SELECT set_config('split.shared_tables', :'shared_tables', true);
DO $$
DECLARE
  network text[] := string_to_array(current_setting('split.network_tables'), ',');
  shared text[] := string_to_array(current_setting('split.shared_tables'), ',');
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
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.prokind = 'f' AND NOT EXISTS (
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
"${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 --single-transaction \
  <<<"ALTER SCHEMA preprod RENAME TO mainnet;
$dump"

bodies="${here%/scripts}/prisma/network-layout/shared-trigger-bodies.sql"
{
  cat <<'SQL'
CREATE TEMP TABLE functions_before ON COMMIT DROP AS
SELECT oid, ctid AS row_version FROM pg_proc WHERE pronamespace = 'shared'::regnamespace;
SQL
  cat "$bodies"
  cat <<'SQL'
DO $check$
DECLARE
  file CONSTANT text := 'packages/database/prisma/network-layout/shared-trigger-bodies.sql';
  list CONSTANT text := 'the waiting list in packages/database/scripts/split-network-layout.sh';
  -- Functions the file does not replace yet.
  waiting CONSTANT text[] := ARRAY[
    -- Ticket 19 part 2: they read the Network named on the row (tickets 07 to 09).
    'shared.scope_notification_to_workspace_membership()',
    'shared.sync_history_from_project_image_asset()',
    'shared.sync_history_from_project_image_job_charge()',
    'shared.sync_history_from_task()',
    'shared.sync_history_from_task_event()',
    'shared.upsert_history_task(text)',
    'shared.upsert_history_image_asset(uuid)',
    'shared.history_task_amount(text)',
    'shared.history_image_amount(uuid)',
    -- Ticket 19 slice B: on Network tables, one copy per Network.
    'shared.canonicalize_credit_cost_unit_write()',
    'shared.complete_task_x402_payment_action_snapshot()',
    'shared.normalize_task_x402_payment_replay_key()',
    'shared.record_task_x402_payment_failure_outcome()',
    'shared.enforce_job_project_workspace_placement()',
    'shared.sync_history_from_job()',
    'shared.sync_history_from_job_event()',
    'shared.sync_history_from_job_input()',
    'shared.sync_history_from_job_purchase()',
    'shared.sync_history_from_transaction()',
    'shared.canonical_credit_cost_unit(text)',
    'shared.history_job_amount(text)',
    'shared.upsert_history_job(text)',
    -- Core calls it by its bare name (`EXCEPTIONS` in apps/core/scripts/prepare-raw-sql.ts).
    'shared.compute_history_job_status(text)'
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
      EXISTS (SELECT FROM unnest(waiting) AS listed(name) WHERE to_regprocedure(name) = p.oid) AS waits
    FROM pg_proc p
    LEFT JOIN functions_before b ON b.oid = p.oid
    WHERE p.pronamespace = 'shared'::regnamespace
  LOOP
    IF fn.created THEN
      RAISE EXCEPTION '% creates %, which no migration creates with that signature: update or remove it', file, fn.signature;
    ELSIF fn.in_file AND fn.waits THEN
      RAISE EXCEPTION 'function % is in % now: remove it from %', fn.signature, file, list;
    ELSIF NOT fn.in_file AND NOT fn.waits THEN
      RAISE EXCEPTION 'function % has no body for the new layout: add it to % with its digest, or to % with the ticket it waits for',
        fn.signature, file, list;
    END IF;
  END LOOP;
END
$check$;
SQL
} | "${psql[@]}" "$url" --quiet --output=/dev/null -v ON_ERROR_STOP=1 --single-transaction || {
  echo "split-network-layout.sh: step 4 failed while applying or checking $bodies" >&2
  exit 1
}
