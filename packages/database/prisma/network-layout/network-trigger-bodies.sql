-- Trigger and function bodies for the three-schema layout (`shared`, `mainnet`,
-- `preprod`): the functions behind the triggers and CHECKs on Network tables,
-- and the helpers only they call (`networkFunctions` in
-- `prisma/network-tables.json`). Each Network schema holds its own copy. Each
-- body is the one the migrations created, with every table, type and function
-- named with its schema: the Network's own for a Network object, `shared` for
-- a shared one. A trigger runs on its caller's search path, so a bare name
-- would resolve there or not at all.
--
-- A template, not SQL to apply as it is: `@network@` stands for the Network's
-- schema, and it is the only thing that differs between the two copies. Each
-- copy is this text with that one replacement, which is all a reader needs to
-- get the plain SQL of a Network:
--
--   sed 's/@network@/mainnet/g' network-trigger-bodies.sql
--   sed 's/@network@/preprod/g' network-trigger-bodies.sql
--
-- One fixed word replaced, rather than a generator or two committed copies:
-- the split script and the cutover can both do it, nothing can be edited in
-- one copy and forgotten in the other, and PostgreSQL refuses the text when
-- the replacement was not made. Never write `mainnet` or `preprod` in a body
-- here: that copy would then reach into the other Network.
--
-- Not a migration. Today's layout keeps the migrations' bodies. Only
-- `scripts/split-network-layout.sh` applies this file, to CI's split test
-- database, once per Network. The move script of the maintenance window
-- applies the same text.
--
-- Contract: apply each copy once, in one transaction that stops at the first
-- error (`psql --single-transaction -v ON_ERROR_STOP=1`), after the Network's
-- functions are in its schema with the triggers and CHECKs of its tables bound
-- to them. The file does not open that transaction; the split script does, and
-- the cutover's script owns it at the window. Without it a refusal of the
-- guard does not stop the statements after it.
--
-- The guard refuses unless each function below is in the Network's schema with
-- the body the migrations create, by digest. So a second run refuses too. That
-- only schema names differ from those bodies is not checked by any code: it
-- was compared once for this text, and every later change to a body is
-- reviewed against its migration before its digest is updated.
--
-- Not here yet: the History sync triggers on Network tables and their helpers
-- (the split script lists them as waiting).

DO $guard$
DECLARE
  file CONSTANT text := 'packages/database/prisma/network-layout/network-trigger-bodies.sql';
  network CONSTANT regnamespace := to_regnamespace('@network@');
  -- The digests hold catalog text that these two settings change.
  settings CONSTANT text[] := ARRAY[current_setting('search_path'), current_setting('quote_all_identifiers')];
  problem text;
  changed text;
  checked oid[] := '{}';
  fn record;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO problem
  FROM unnest(ARRAY['shared', '@network@']) AS expected(name)
  WHERE to_regnamespace(name) IS NULL;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'network-trigger-bodies.sql needs the three-schema layout; missing schema: %', problem;
  END IF;
  PERFORM set_config('search_path', 'pg_catalog', true), set_config('quote_all_identifiers', 'off', true);

  -- Every function this file replaces, with the digest of what the migrations
  -- create: body, language, volatility, strictness, security, settings,
  -- arguments and return type, and what else CREATE OR REPLACE sets again:
  -- parallel safety, cost, rows, leakproof and the support function. A window
  -- function is refused below (`prokind`).
  FOR fn IN
    SELECT '@network@.' || listed.signature AS signature, listed.digest, p.oid, p.proname, p.prokind,
      md5(concat_ws(E'\n', p.prosrc, l.lanname, p.provolatile, p.proisstrict, p.prosecdef, p.proconfig,
        pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
        p.proparallel, p.procost, p.prorows, p.proleakproof, p.prosupport)) AS found
    FROM (VALUES
      ('canonical_credit_cost_unit(text)', '7eb707322590dbe6169be1902a7cf904'),
      ('canonicalize_credit_cost_unit_write()', '0cc3908554473ec121e38746a4698ebb'),
      ('complete_task_x402_payment_action_snapshot()', '708d42f9fb18e6744588ae98a711607a'),
      ('enforce_job_project_workspace_placement()', '236c56cf1e4537c8dc2ad7c2b8f1639c'),
      ('normalize_task_x402_payment_replay_key()', '03c423a077261b9551e660240868ab3c'),
      ('record_task_x402_payment_failure_outcome()', '6d2c9c21bd2204ad67840cc5a6cc0b40')
    ) AS listed(signature, digest)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure('@network@.' || listed.signature)
    LEFT JOIN pg_language l ON l.oid = p.prolang
    ORDER BY 1
  LOOP
    IF fn.prokind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'network-trigger-bodies.sql needs the three-schema layout; missing function: %', fn.signature;
    END IF;
    checked := checked || fn.oid;

    -- A trigger or a CHECK keeps the function it was created with, so a
    -- function of this name left outside the Network's schema, in `shared` or
    -- in the other Network, would go on running there.
    SELECT string_agg(bound_by.what, ', ') INTO problem
    FROM (
      SELECT format('trigger %s on %s', t.tgname, t.tgrelid::regclass) AS what, t.tgrelid AS relation, t.tgfoid AS runs
      FROM pg_trigger t
      UNION ALL
      SELECT format('constraint %s on %s', c.conname, c.conrelid::regclass), c.conrelid, d.refobjid
      FROM pg_constraint c
      JOIN pg_depend d ON d.classid = 'pg_constraint'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_proc'::regclass
    ) AS bound_by
    JOIN pg_class c ON c.oid = bound_by.relation AND c.relnamespace = network
    JOIN pg_proc bound ON bound.oid = bound_by.runs
    WHERE bound.proname = fn.proname AND bound.pronamespace <> network;
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION 'network-trigger-bodies.sql needs the three-schema layout; % runs a % that is not in @network@', problem, fn.proname;
    END IF;

    IF fn.found <> fn.digest THEN
      changed := concat_ws(', ', changed, format('%s (digest now %s)', fn.signature, fn.found));
    END IF;
  END LOOP;
  -- This file replaces every function of the Network's schema, so each must
  -- have had its digest compared above: one without a line there would be
  -- replaced whatever a migration made of it.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO problem
  FROM pg_proc p
  WHERE p.pronamespace = network AND p.oid <> ALL (checked)
    AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'no digest for %: add its line to the guard of %', problem, file;
  END IF;
  IF changed IS NOT NULL THEN
    RAISE EXCEPTION 'a migration changed this function: %. Update its body in %, check by eye that only schema names differ from the migration''s body, then update its digest there',
      changed, file;
  END IF;
  PERFORM set_config('search_path', settings[1], true), set_config('quote_all_identifiers', settings[2], true);
END
$guard$;

CREATE OR REPLACE FUNCTION @network@.canonical_credit_cost_unit(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN BTRIM(
      $1,
      CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || CHR(32)
    ) = ''
      OR LOWER(BTRIM(
        $1,
        CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || CHR(32)
      )) = 'lovelace'
    THEN 'lovelace'
    ELSE LOWER(BTRIM(
      $1,
      CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || CHR(32)
    ))
  END
$function$;

CREATE OR REPLACE FUNCTION @network@.canonicalize_credit_cost_unit_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW."unit" := @network@."canonical_credit_cost_unit"(NEW."unit");
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION @network@.complete_task_x402_payment_action_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  completed_organization_id TEXT;
  completed_charge_id TEXT;
  completed_refund_id TEXT;
BEGIN
  IF NEW."chargedOrganizationId" IS NULL
    OR NEW."chargeTransactionId" IS NULL
    OR NEW."refundTransactionId" IS NULL
  THEN
    SELECT
      COALESCE(NEW."chargedOrganizationId", charge."organizationId"),
      COALESCE(NEW."chargeTransactionId", payment."transactionId"),
      COALESCE(NEW."refundTransactionId", payment."refundTransactionId")
    INTO
      completed_organization_id,
      completed_charge_id,
      completed_refund_id
    FROM @network@."task_x402_payment" AS payment
    INNER JOIN @network@."Transaction" AS charge
      ON charge."id" = payment."transactionId"
    WHERE payment."id" = NEW."paymentId";

    IF FOUND THEN
      NEW."chargedOrganizationId" := completed_organization_id;
      NEW."chargeTransactionId" := completed_charge_id;
      NEW."refundTransactionId" := completed_refund_id;
    ELSIF NEW."chargeTransactionId" IS NULL
      OR NEW."refundTransactionId" IS NULL
    THEN
      RAISE EXCEPTION
        'Cannot write incomplete task x402 action snapshot without its source payment';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION @network@.enforce_job_project_workspace_placement()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."projectId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM shared."project" AS p
      WHERE p.id = NEW."projectId"
        AND p."workspaceId" = NEW."workspaceId"
    ) THEN
      RAISE EXCEPTION 'Job projectId must reference a project in the same workspace as workspaceId'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.normalize_task_x402_payment_replay_key()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW."caip2Network" := LOWER(NEW."caip2Network");
  NEW."asset" := LOWER(NEW."asset");
  NEW."payerAddress" := LOWER(NEW."payerAddress");
  NEW."payloadNonce" := LOWER(NEW."payloadNonce");
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.record_task_x402_payment_failure_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW."status" = 'FAILED' AND NEW."refundTransactionId" IS NOT NULL THEN
    INSERT INTO @network@."task_x402_payment_action" (
      "id",
      "createdAt",
      "paymentId",
      "action",
      "operatorId",
      "reason",
      "cents",
      "amount",
      "asset",
      "caip2Network",
      "taskId",
      "agentId",
      "chargedUserId",
      "chargedOrganizationId",
      "chargeTransactionId",
      "refundTransactionId"
    )
    SELECT
      gen_random_uuid()::TEXT,
      CURRENT_TIMESTAMP,
      NEW."id",
      'failure',
      'system:x402',
      CASE
        WHEN NEW."failureReason" IN (
          'node_refused_payload',
          'node_refused_operational'
        ) THEN NEW."failureReason"
        ELSE 'legacy_node_refusal'
      END,
      CASE
        WHEN charge."amount" < 0 THEN charge."amount" * -1
        ELSE charge."amount"
      END,
      NEW."amount",
      NEW."asset",
      NEW."caip2Network",
      NEW."taskId",
      NEW."agentId",
      charge."userId",
      charge."organizationId",
      NEW."transactionId",
      NEW."refundTransactionId"
    FROM @network@."Transaction" AS charge
    WHERE charge."id" = NEW."transactionId"
    ON CONFLICT ("paymentId") WHERE "action" = 'failure' DO NOTHING;
  END IF;

  RETURN NEW;
END
$function$;
