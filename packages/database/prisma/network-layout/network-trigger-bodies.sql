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
-- applies the same text, except for the History sync functions: see the known
-- limit below.
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
-- Known limit of the History sync functions below (`sync_history_from_*`,
-- `upsert_history_job` and its two helpers): they write `shared."history"`,
-- whose key is still (kind, entityId) without the Network, and they do not set
-- the row's `network`. A Job id that exists on both Networks has one History
-- row, and the Network written last owns it: a Preprod Job can overwrite or
-- delete the History row of a Mainnet Job. That is accepted on CI's split test
-- database only. The window must not install this text for them: it installs
-- the bodies of ticket 19 part 2, which delete and upsert the History row by
-- (kind, entityId, network) on the keys ticket 09 adds. New keys alone do not
-- help, because these bodies still delete by Job id and upsert on the old
-- key.
--
-- `sync_history_from_transaction` finds the Task events of a Transaction by
-- its id alone, in both Networks' copies. An id that exists on both Networks
-- so refreshes a Task's History row once more than needed; the row is computed
-- again from its sources (`shared.upsert_history_task`), so nothing is wrong
-- after it.

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
  -- Cost and rows are `real`: as numeric their text does not follow the
  -- session's `extra_float_digits`.
  FOR fn IN
    SELECT '@network@.' || listed.signature AS signature, listed.digest, p.oid, p.proname, p.prokind,
      md5(concat_ws(E'\n', p.prosrc, l.lanname, p.provolatile, p.proisstrict, p.prosecdef, p.proconfig,
        pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
        p.proparallel, p.procost::numeric, p.prorows::numeric, p.proleakproof, p.prosupport)) AS found
    FROM (VALUES
      ('canonical_credit_cost_unit(text)', '7eb707322590dbe6169be1902a7cf904'),
      ('canonicalize_credit_cost_unit_write()', '0cc3908554473ec121e38746a4698ebb'),
      ('complete_task_x402_payment_action_snapshot()', '708d42f9fb18e6744588ae98a711607a'),
      ('compute_history_job_status(text)', '11ed240e03d668a32d06b58b7fea0892'),
      ('enforce_job_project_workspace_placement()', '236c56cf1e4537c8dc2ad7c2b8f1639c'),
      ('history_job_amount(text)', 'dac4d7e001dafb319b0639ea64f99cfb'),
      ('normalize_task_x402_payment_replay_key()', '03c423a077261b9551e660240868ab3c'),
      ('record_task_x402_payment_failure_outcome()', '6d2c9c21bd2204ad67840cc5a6cc0b40'),
      ('sync_history_from_job()', '744228a94191023b5c32e1ef8b13f0a4'),
      ('sync_history_from_job_event()', '446d58b8108a70029a99816a868d037c'),
      ('sync_history_from_job_input()', '3a59446d6e2b7380f0d4d7bc6e574975'),
      ('sync_history_from_job_purchase()', '446d58b8108a70029a99816a868d037c'),
      ('sync_history_from_transaction()', '580a797cf30c70160deff0b4109981e2'),
      ('upsert_history_job(text)', 'c0094858168f917afeca9d3ff4627c67')
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

CREATE OR REPLACE FUNCTION @network@.compute_history_job_status(job_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  source_job RECORD;
  latest_status TEXT;
  latest_has_input BOOLEAN;
  payment_deadline TIMESTAMP(3);
BEGIN
  SELECT
    j.*,
    p."onChainStatus"::TEXT AS "onChainStatusText",
    p."nextAction"::TEXT AS "nextActionText"
  INTO source_job
  FROM @network@."Job" AS j
  LEFT JOIN @network@."jobPurchase" AS p ON p."jobId" = j."id"
  WHERE j."id" = job_id;

  IF NOT FOUND THEN
    RETURN 'started';
  END IF;

  SELECT e."status"::TEXT, i."id" IS NOT NULL
  INTO latest_status, latest_has_input
  FROM @network@."jobEvent" AS e
  LEFT JOIN @network@."jobInput" AS i ON i."eventId" = e."id"
  WHERE e."jobId" = job_id
  ORDER BY e."createdAt" DESC, e."id" DESC
  LIMIT 1;

  IF source_job."jobType"::TEXT = 'FREE' THEN
    IF latest_status IS NULL THEN
      RETURN 'started';
    END IF;

    CASE latest_status
      WHEN 'INITIATED' THEN RETURN 'processing';
      WHEN 'AWAITING_PAYMENT' THEN RETURN 'failed';
      WHEN 'AWAITING_INPUT' THEN
        IF latest_has_input THEN
          RETURN 'processing';
        END IF;
        RETURN 'input_required';
      WHEN 'RUNNING' THEN RETURN 'processing';
      WHEN 'COMPLETED' THEN RETURN 'completed';
      WHEN 'FAILED' THEN RETURN 'failed';
      ELSE RETURN 'failed';
    END CASE;
  END IF;

  IF source_job."refundedTransactionId" IS NOT NULL THEN
    RETURN 'refund_resolved';
  END IF;

  IF source_job."onChainStatusText" IS NULL
    AND source_job."nextActionText" IS NULL THEN
    payment_deadline := COALESCE(source_job."payByTime", source_job."createdAt");

    IF payment_deadline < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
      RETURN 'payment_failed';
    END IF;

    RETURN 'payment_pending';
  END IF;

  IF source_job."nextActionText" IN (
    'FUNDS_LOCKING_INITIATED',
    'FUNDS_LOCKING_REQUESTED'
  ) THEN
    RETURN 'payment_pending';
  END IF;

  IF source_job."nextActionText" IN (
    'SET_REFUND_REQUESTED_INITIATED',
    'SET_REFUND_REQUESTED_REQUESTED',
    'UNSET_REFUND_REQUESTED_INITIATED',
    'UNSET_REFUND_REQUESTED_REQUESTED'
  ) THEN
    RETURN 'refund_pending';
  END IF;

  IF latest_status IS NULL THEN
    RETURN 'started';
  END IF;

  IF source_job."onChainStatusText" IS NULL THEN
    RETURN 'payment_pending';
  END IF;

  CASE source_job."onChainStatusText"
    WHEN 'FUNDS_LOCKED' THEN
      CASE latest_status
        WHEN 'INITIATED' THEN RETURN 'payment_pending';
        WHEN 'AWAITING_PAYMENT' THEN RETURN 'payment_pending';
        WHEN 'AWAITING_INPUT' THEN
          IF latest_has_input THEN
            RETURN 'processing';
          END IF;
          RETURN 'input_required';
        WHEN 'COMPLETED' THEN RETURN 'completed';
        WHEN 'FAILED' THEN RETURN 'failed';
        ELSE
          IF source_job."externalDisputeUnlockTime" IS NOT NULL
            AND source_job."externalDisputeUnlockTime" < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
            RETURN 'failed';
          END IF;

          IF source_job."submitResultTime" IS NOT NULL
            AND source_job."submitResultTime" < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
            RETURN 'result_pending';
          END IF;

          RETURN 'processing';
      END CASE;
    WHEN 'RESULT_SUBMITTED', 'WITHDRAW_AUTHORIZED' THEN
      IF latest_status = 'COMPLETED' THEN
        RETURN 'completed';
      END IF;
      RETURN 'result_pending';
    WHEN 'FUNDS_WITHDRAWN' THEN
      IF latest_status = 'COMPLETED' THEN
        RETURN 'completed';
      END IF;
      RETURN 'failed';
    WHEN 'FUNDS_OR_DATUM_INVALID' THEN RETURN 'payment_failed';
    WHEN 'REFUND_REQUESTED', 'REFUND_AUTHORIZED' THEN RETURN 'refund_pending';
    WHEN 'REFUND_WITHDRAWN' THEN RETURN 'refund_resolved';
    WHEN 'DISPUTED' THEN RETURN 'dispute_pending';
    WHEN 'DISPUTED_WITHDRAWN' THEN RETURN 'dispute_resolved';
    ELSE RETURN 'payment_pending';
  END CASE;
END;
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

CREATE OR REPLACE FUNCTION @network@.history_job_amount(job_id text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(ABS(t."amount"), 0)::BIGINT
  FROM @network@."Job" AS j
  LEFT JOIN @network@."Transaction" AS t ON t."id" = j."transactionId"
  WHERE j."id" = job_id;
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

CREATE OR REPLACE FUNCTION @network@.sync_history_from_job()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM shared."history"
    WHERE "kind" = 'JOB'::shared."HistoryKind"
      AND "entityId" = OLD."id";
    RETURN OLD;
  END IF;

  PERFORM @network@.upsert_history_job(NEW."id");
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.sync_history_from_job_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM @network@.upsert_history_job(OLD."jobId");
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM @network@.upsert_history_job(NEW."jobId");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.sync_history_from_job_input()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  linked_job_id TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT e."jobId"
    INTO linked_job_id
    FROM @network@."jobEvent" AS e
    WHERE e."id" = OLD."eventId";

    IF linked_job_id IS NOT NULL THEN
      PERFORM @network@.upsert_history_job(linked_job_id);
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT e."jobId"
    INTO linked_job_id
    FROM @network@."jobEvent" AS e
    WHERE e."id" = NEW."eventId";

    IF linked_job_id IS NOT NULL THEN
      PERFORM @network@.upsert_history_job(linked_job_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.sync_history_from_job_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM @network@.upsert_history_job(OLD."jobId");
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM @network@.upsert_history_job(NEW."jobId");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.sync_history_from_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  linked_job_id TEXT;
  linked_task_id TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "id"
    INTO linked_job_id
    FROM @network@."Job"
    WHERE "transactionId" = OLD."id";

    IF linked_job_id IS NOT NULL THEN
      PERFORM @network@.upsert_history_job(linked_job_id);
    END IF;

    FOR linked_task_id IN
      SELECT DISTINCT "taskId"
      FROM shared."taskEvent"
      WHERE "transactionId" = OLD."id"
    LOOP
      PERFORM shared.upsert_history_task(linked_task_id);
    END LOOP;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "id"
    INTO linked_job_id
    FROM @network@."Job"
    WHERE "transactionId" = NEW."id";

    IF linked_job_id IS NOT NULL THEN
      PERFORM @network@.upsert_history_job(linked_job_id);
    END IF;

    FOR linked_task_id IN
      SELECT DISTINCT "taskId"
      FROM shared."taskEvent"
      WHERE "transactionId" = NEW."id"
    LOOP
      PERFORM shared.upsert_history_task(linked_task_id);
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION @network@.upsert_history_job(job_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  source_job RECORD;
BEGIN
  SELECT j.*, a."name" AS "agentName"
  INTO source_job
  FROM @network@."Job" AS j
  LEFT JOIN @network@."Agent" AS a ON a."id" = j."agentId"
  WHERE j."id" = job_id;

  IF NOT FOUND THEN
    DELETE FROM shared."history"
    WHERE "kind" = 'JOB'::shared."HistoryKind"
      AND "entityId" = job_id;
    RETURN;
  END IF;

  INSERT INTO shared."history" (
    "id",
    "kind",
    "entityId",
    "userId",
    "workspaceId",
    "organizationId",
    "title",
    "description",
    "status",
    "sortAt",
    "amount",
    "projectId",
    "agentId",
    "coworkerId",
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'JOB'::shared."HistoryKind",
    source_job."id",
    source_job."ownerId",
    source_job."workspaceId",
    source_job."organizationId",
    COALESCE(source_job."name", source_job."agentName", 'Untitled job'),
    NULL,
    @network@.compute_history_job_status(source_job."id"),
    source_job."createdAt",
    @network@.history_job_amount(source_job."id"),
    source_job."projectId",
    source_job."agentId",
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT ("kind", "entityId") DO UPDATE
  SET
    "userId" = EXCLUDED."userId",
    "workspaceId" = EXCLUDED."workspaceId",
    "organizationId" = EXCLUDED."organizationId",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "status" = EXCLUDED."status",
    "sortAt" = EXCLUDED."sortAt",
    "amount" = EXCLUDED."amount",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$function$;
