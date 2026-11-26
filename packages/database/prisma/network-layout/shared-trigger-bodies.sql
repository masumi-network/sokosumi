-- Trigger and function bodies for the three-schema layout (`shared`, `mainnet`,
-- `preprod`): the functions behind the triggers on shared tables that reach
-- shared objects only, and the helpers they call. Each body is the one the
-- migrations created, with every table, type, sequence and function named with
-- its schema; a trigger runs on its caller's search path, so a bare name would
-- resolve there or not at all.
--
-- Not a migration. Today's layout keeps the migrations' bodies. Only
-- `scripts/split-network-layout.sh` applies this file, to CI's split test
-- database. The move script of the maintenance window applies the same text.
--
-- Contract: apply it once, in one transaction that stops at the first error
-- (`psql --single-transaction -v ON_ERROR_STOP=1`). The file does not open
-- that transaction; the split script does, and the cutover's script owns it at
-- the window. Without it a refusal of the guard does not stop the statements
-- after it.
--
-- The guard refuses unless each function below is in `shared` with the body
-- the migrations create, by digest. So a second run refuses too. That only
-- schema names differ from those bodies is not checked by any code: it was
-- compared once for this text, and every later change to a body is reviewed
-- against its migration before its digest is updated.
--
-- Not here: functions that need the row's Network (ticket 19 part 2; the split
-- script lists them as waiting) and the functions on Network tables, which
-- each Network schema holds a copy of (`network-trigger-bodies.sql`).

DO $guard$
DECLARE
  file CONSTANT text := 'packages/database/prisma/network-layout/shared-trigger-bodies.sql';
  -- The digests hold catalog text that these two settings change.
  settings CONSTANT text[] := ARRAY[current_setting('search_path'), current_setting('quote_all_identifiers')];
  problem text;
  changed text;
  fn record;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO problem
  FROM unnest(ARRAY['shared', 'mainnet', 'preprod']) AS expected(name)
  WHERE to_regnamespace(name) IS NULL;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'shared-trigger-bodies.sql needs the three-schema layout; missing schema: %', problem;
  END IF;
  PERFORM set_config('search_path', 'pg_catalog', true), set_config('quote_all_identifiers', 'off', true);

  -- Every function this file replaces, with the digest of what the migrations
  -- create: body, language, volatility, strictness, security, settings,
  -- arguments and return type, and what else CREATE OR REPLACE sets again:
  -- parallel safety, cost, rows, leakproof and the support function. A window
  -- function is refused below (`prokind`).
  FOR fn IN
    SELECT 'shared.' || listed.signature AS signature, listed.digest, p.proname, p.prokind,
      md5(concat_ws(E'\n', p.prosrc, l.lanname, p.provolatile, p.proisstrict, p.prosecdef, p.proconfig,
        pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
        p.proparallel, p.procost, p.prorows, p.proleakproof, p.prosupport)) AS found
    -- A function replaced below without a line here is not compared with its
    -- migration. This guard cannot find one: `shared` also holds functions
    -- this file does not replace (the split script's waiting list).
    FROM (VALUES
      ('calendar_access_cleanup_on_member_delete()', '610ee6273e89a19af3a5042f6b0b8b74'),
      ('calendar_membership_fence_on_member_insert()', 'c2ca047a096a082a27d72111a9cfa533'),
      ('cancel_grant_pending_tasks_on_grant_delete()', '231b79f359d27071239a31453431bf6e'),
      ('chat_room_external_discoverability_guard()', '40cc7ba7c811b48e5e24234e0bccab2a'),
      ('chat_room_guest_access_external_only()', '9e2c46452bef6478028d3322be2d4cff'),
      ('chat_room_guest_invitation_external_only()', '651d2db6e9942d049f6fbe8e41db0097'),
      ('chat_room_hard_leave_on_organization_member_delete()', '404dd5a01bf6c8003e4b7856eb1d78f1'),
      ('chat_room_join_shared_soko_bot_rooms_on_member_insert()', 'fff9e2272421c31484d3ee79a413acf1'),
      ('clear_moved_task_workspace_tags()', '3e7ad8968f66d96c81162698988fcdfe'),
      ('contact_search_on_channel_delete()', '6969bcfb8b488d9dee99f6bf45ec098e'),
      ('contact_search_on_channel_insert()', '8ad1fa9f52d8c17c0167155146e43150'),
      ('contact_search_on_channel_update()', 'fc79f2989bb8ce169fcf110d5a691a47'),
      ('contact_search_on_contact()', '4301d86f864c5dfa0ffe69adb7fcb6cc'),
      ('contact_search_refresh(uuid)', 'eb7710bf5a801ae762314a88fc2420b0'),
      ('enforce_task_project_workspace_placement()', 'f9bb4c7ff2ec5f2cac7930bcfba57530'),
      ('enqueue_calendar_feature_invalidation(uuid,uuid,uuid,uuid,jsonb)', '4920d8eaf58855d94eb66a97f543ba86'),
      ('enqueue_calendar_invalidation(uuid,uuid,uuid,jsonb)', '144218e45d23e3b7f16abb58b5ce55c9'),
      ('erase_calendar_outbox_for_workspace_delete()', '60e1e659b70377e7f16288d70324523c'),
      ('history_bucket_slug_from_metadata(jsonb)', 'f75544f0226a41435b455199e227c325'),
      ('history_slugify(text)', '14f4c248f71f03bcf140f7c6625205a1'),
      ('invalidate_calendar_for_contact_change()', '58b978046028054c43c59a0efe3d68a2'),
      ('invalidate_calendar_for_marketing_strategy_change()', '2ce1e533a94eac55bc51b35dc4f2101d'),
      ('invalidate_calendar_for_marketing_strategy_file_change()', '9f10c01ae614215169be6cb1b54ecd68'),
      ('invalidate_calendar_for_newsletter_issue_change()', 'cc99a9c975c485f3c6d3a53abcab2a02'),
      ('invalidate_calendar_for_project_change()', 'ab0ba2aac368842086d42ed7ed737bc0'),
      ('invalidate_calendar_for_run_change()', 'bcb93a47e8bae04da1ff74dbd11d49f8'),
      ('invalidate_calendar_for_social_post_change()', '058da8610fafb5ed853b6cb2839dc46c'),
      ('invalidate_calendar_for_task_change()', 'cf7c45d12e6c0d08ef0a7e9a7c00597e'),
      ('invalidate_calendar_for_task_schedule_change()', '608f449fc0ef140cf285ee1239a60406'),
      ('invalidate_changed_workspace_tag_offers()', '053f53bf8060e1fa9b30688edb6759dd'),
      ('invalidate_task_workspace_tag_suggestions()', '216f1a4395fb53738ca97c71be7e68dd'),
      ('project_alias_old_identifier()', 'd3f6e922939239f81b93e4c7c14071cd'),
      ('project_default_identifier(text,uuid)', '815ad18acc7c9b59e821eae2068489b3'),
      ('project_set_identifier()', '51ebc5342f951bae9afa844890a270bd'),
      ('reject_soko_bot_admin_action_mutation()', '391039c4aa764e7bc57591bb963aa590'),
      ('social_post_quote_before_delete()', '5c033f342f04a15fd5a5f434745fcf28'),
      ('task_alias_old_number()', 'ef2b3f591be26eb257c3aa14b06dad68'),
      ('task_assign_number()', 'c7ed9b511a18321323c9fd36f80fdb75'),
      ('task_subtask_follow_parent()', '302228a69d5f1ab1d421c913d722976a'),
      ('task_subtask_guard()', '20887f6150174f6d679c7f8323693869'),
      ('task_tag_revision()', '584d8ba0c0719e4fdbf87f6cfad055ce')
    ) AS listed(signature, digest)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure('shared.' || listed.signature)
    LEFT JOIN pg_language l ON l.oid = p.prolang
    ORDER BY 1
  LOOP
    IF fn.prokind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'shared-trigger-bodies.sql needs the three-schema layout; missing function: %', fn.signature;
    END IF;

    -- A trigger keeps the function it was created with, so a function of this
    -- name left outside `shared` would go on running the old body.
    SELECT string_agg(format('%s on %s', t.tgname, t.tgrelid::regclass), ', ') INTO problem
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid AND c.relnamespace = 'shared'::regnamespace
    JOIN pg_proc bound ON bound.oid = t.tgfoid
    WHERE bound.proname = fn.proname AND bound.pronamespace <> 'shared'::regnamespace;
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION 'shared-trigger-bodies.sql needs the three-schema layout; trigger % runs a % that is not in shared', problem, fn.proname;
    END IF;

    IF fn.found <> fn.digest THEN
      changed := concat_ws(', ', changed, format('%s (digest now %s)', fn.signature, fn.found));
    END IF;
  END LOOP;
  IF changed IS NOT NULL THEN
    RAISE EXCEPTION 'a migration changed this function: %. Update its body in %, check by eye that only schema names differ from the migration''s body, then update its digest there',
      changed, file;
  END IF;
  PERFORM set_config('search_path', settings[1], true), set_config('quote_all_identifiers', settings[2], true);
END
$guard$;

CREATE OR REPLACE FUNCTION shared.calendar_access_cleanup_on_member_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  organization_workspace_id UUID;
  pending_notification_emails JSONB;
BEGIN
  SELECT id INTO organization_workspace_id
  FROM shared."workspace"
  WHERE "organizationId" = OLD."organizationId";

  IF organization_workspace_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Hold the same lock as the publisher across cleanup and the revoke event,
  -- so no stale membership snapshot can fan out after removal commits.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'calendar-members:' || organization_workspace_id::TEXT,
      0
    )
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'emailId', "emailId",
    'emailScheduledAt', "emailScheduledAt"
  )), '[]'::jsonb)
  INTO pending_notification_emails
  FROM shared."notification"
  WHERE "userId" = OLD."userId"
    AND "workspaceId" = organization_workspace_id
    AND "emailId" IS NOT NULL
    AND "emailScheduledAt" > CURRENT_TIMESTAMP;

  DELETE FROM shared."notification"
  WHERE "userId" = OLD."userId"
    AND "workspaceId" = organization_workspace_id;

  PERFORM shared.enqueue_calendar_invalidation(
    organization_workspace_id,
    NULL,
    NULL,
    jsonb_build_object(
      'kind', 'calendar_access_revoked',
      'userId', OLD."userId",
      'organizationId', OLD."organizationId",
      'pendingNotificationEmails', pending_notification_emails
    )
  );

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.calendar_membership_fence_on_member_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  organization_workspace_id UUID;
BEGIN
  SELECT id INTO organization_workspace_id
  FROM shared."workspace"
  WHERE "organizationId" = NEW."organizationId";

  IF organization_workspace_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'calendar-members:' || organization_workspace_id::TEXT,
        0
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.cancel_grant_pending_tasks_on_grant_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE shared."task"
  SET
    "status" = 'CANCELED'::shared."TaskStatus",
    "grantResumeStatus" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "pendingVendorGrantId" = OLD."id"
    AND "status"::text = 'GRANT_PENDING'
    AND "archivedAt" IS NULL;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.chat_room_external_discoverability_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."discoverability" IS DISTINCT FROM 'external' THEN
    RETURN NEW;
  END IF;

  IF NEW."discoverability" IS NOT DISTINCT FROM 'external' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shared."chat_room_user_member" m
    WHERE m."roomId" = OLD."id"
      AND m."access" = 'guest'
  ) THEN
    RAISE EXCEPTION 'cannot change discoverability while guest members remain'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shared."chat_room_guest_invitation" i
    WHERE i."roomId" = OLD."id"
      AND i."status" = 'pending'
      AND i."expiresAt" > NOW()
  ) THEN
    RAISE EXCEPTION 'cannot change discoverability while pending guest invitations remain'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.chat_room_guest_access_external_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  room_discoverability text;
BEGIN
  IF NEW."access" = 'guest' THEN
    SELECT r."discoverability"
    INTO room_discoverability
    FROM shared."chat_room" r
    WHERE r."id" = NEW."roomId"
    FOR UPDATE;

    IF room_discoverability IS DISTINCT FROM 'external' THEN
      RAISE EXCEPTION 'guest access is only allowed on external channels'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.chat_room_guest_invitation_external_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  room_discoverability text;
  room_kind text;
BEGIN
  SELECT r."discoverability", r."kind"
  INTO room_discoverability, room_kind
  FROM shared."chat_room" r
  WHERE r."id" = NEW."roomId"
  FOR UPDATE;

  IF room_discoverability IS DISTINCT FROM 'external'
    OR room_kind IS DISTINCT FROM 'channel' THEN
    RAISE EXCEPTION 'guest invitations are only allowed on external channels'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.chat_room_hard_leave_on_organization_member_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  actor_name text;
  left_room_ids uuid[];
BEGIN
  SELECT COALESCE(NULLIF(BTRIM(u."name"), ''), 'Someone')
  INTO actor_name
  FROM shared."user" u
  WHERE u."id" = OLD."userId";

  IF actor_name IS NULL THEN
    actor_name := 'Someone';
  END IF;

  SELECT COALESCE(array_agg(m."roomId"), ARRAY[]::uuid[])
  INTO left_room_ids
  FROM shared."chat_room_user_member" m
  INNER JOIN shared."chat_room" r ON r."id" = m."roomId"
  WHERE m."userId" = OLD."userId"
    AND r."organizationId" = OLD."organizationId";

  IF cardinality(left_room_ids) = 0 THEN
    RETURN OLD;
  END IF;

  -- Channel timeline "left" for the leaver (same shape as app membership status).
  INSERT INTO shared."chat_room_message" (
    "id",
    "roomId",
    "content",
    "senderUserId",
    "senderCoworkerId",
    "metadata",
    "createdAt"
  )
  SELECT
    gen_random_uuid(),
    r."id",
    actor_name || ' left',
    NULL,
    NULL,
    jsonb_build_object(
      'membership',
      jsonb_build_object(
        'action', 'left',
        'subject',
        jsonb_build_object(
          'type', 'user',
          'id', OLD."userId",
          'name', actor_name
        )
      )
    ),
    CURRENT_TIMESTAMP
  FROM shared."chat_room" r
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'channel';

  -- Status insert is raw SQL (no Prisma @updatedAt). Bump room activity so
  -- lists ordered by updatedAt surface the leave.
  UPDATE shared."chat_room" r
  SET "updatedAt" = CURRENT_TIMESTAMP
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'channel';

  DELETE FROM shared."chat_room_read_state" rs
  WHERE rs."userId" = OLD."userId"
    AND rs."roomId" = ANY (left_room_ids);

  DELETE FROM shared."chat_room_user_member" m
  WHERE m."userId" = OLD."userId"
    AND m."roomId" = ANY (left_room_ids);

  -- Rooms left with zero humans: kill pending guest invites / live invite
  -- links so force-archive cannot leave accept-able pending invites hanging
  -- (accept already rejects archived rooms; this cleans status).
  UPDATE shared."chat_room_guest_invitation" gi
  SET
    "status" = 'revoked',
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE gi."status" = 'pending'
    AND gi."roomId" = ANY (left_room_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM shared."chat_room_user_member" m
      WHERE m."roomId" = gi."roomId"
    );

  UPDATE shared."chat_room_guest_invite_link" l
  SET "revokedAt" = CURRENT_TIMESTAMP
  WHERE l."revokedAt" IS NULL
    AND l."roomId" = ANY (left_room_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM shared."chat_room_user_member" m
      WHERE m."roomId" = l."roomId"
    );

  -- Soft-archive channels left with zero humans (restorable). A shared Soko
  -- Bot's room stays open: the join trigger only adds members to an
  -- unarchived room, so archiving it would lock out everyone who joins later.
  UPDATE shared."chat_room" r
  SET
    "archivedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'channel'
    AND r."archivedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM shared."chat_room_user_member" m
      WHERE m."roomId" = r."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM shared."soko_bot" b
      WHERE b."sharedRoomId" = r."id"
    );

  -- Empty directs: hard-delete. Soft-archive would keep directKey and block
  -- create-or-get; product archive API already forbids archiving directs.
  DELETE FROM shared."chat_room" r
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'direct'
    AND NOT EXISTS (
      SELECT 1
      FROM shared."chat_room_user_member" m
      WHERE m."roomId" = r."id"
    );

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.chat_room_join_shared_soko_bot_rooms_on_member_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  joined_room_ids uuid[];
BEGIN
  PERFORM 1 FROM shared."organization" WHERE "id" = NEW."organizationId" FOR SHARE;

  WITH joined AS (
    INSERT INTO shared."chat_room_user_member" ("id", "roomId", "userId", "access", "createdAt")
    SELECT gen_random_uuid(), r."id", NEW."userId", 'member', CURRENT_TIMESTAMP
    FROM shared."soko_bot" b
    JOIN shared."workspace" w ON w."id" = b."workspaceId"
    JOIN shared."chat_room" r ON r."id" = b."sharedRoomId"
    WHERE b."userId" IS NULL
      AND b."deletedAt" IS NULL
      AND w."organizationId" = NEW."organizationId"
      AND r."organizationId" = NEW."organizationId"
      AND r."kind" = 'channel'
      AND r."archivedAt" IS NULL
    ON CONFLICT ("roomId", "userId") DO NOTHING
    RETURNING "roomId"
  )
  SELECT COALESCE(array_agg("roomId"), ARRAY[]::uuid[])
  INTO joined_room_ids
  FROM joined;

  IF cardinality(joined_room_ids) = 0 THEN
    RETURN NEW;
  END IF;

  -- A newcomer starts caught up: what was said before they joined was not
  -- addressed to them.
  INSERT INTO shared."chat_room_read_state" ("id", "roomId", "userId", "lastReadAt", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), room_id, NEW."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM unnest(joined_room_ids) AS room_id
  ON CONFLICT ("roomId", "userId") DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.clear_moved_task_workspace_tags()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM shared."task_workspace_tag" WHERE "taskId" = NEW.id;
    DELETE FROM shared."task_workspace_tag_decision" WHERE "taskId" = NEW.id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.contact_search_on_channel_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM shared.contact_search_refresh(id)
  FROM (SELECT DISTINCT "contactId" AS id FROM old_rows) touched;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.contact_search_on_channel_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM shared.contact_search_refresh(id)
  FROM (SELECT DISTINCT "contactId" AS id FROM new_rows) touched;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.contact_search_on_channel_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM shared.contact_search_refresh(id)
  FROM (
    SELECT o."contactId" AS id FROM old_rows o JOIN new_rows n USING ("id")
    WHERE o."contactId" <> n."contactId" OR o."value" <> n."value"
    UNION
    SELECT n."contactId" FROM old_rows o JOIN new_rows n USING ("id")
    WHERE o."contactId" <> n."contactId" OR o."value" <> n."value"
  ) touched;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.contact_search_on_contact()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM shared.contact_search_refresh(NEW."id");
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.contact_search_refresh(target uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO shared."contact_search" ("contactId", "workspaceId", "document", "search_vector", "updatedAt")
  SELECT c."id", c."workspaceId", d.document, to_tsvector('simple', d.document), CURRENT_TIMESTAMP
  FROM shared."contact" c
  CROSS JOIN LATERAL (
    SELECT lower(public.unaccent(concat_ws(E'\n',
      c."name", c."organization", c."role", c."location",
      lower(c."stage"::text),
      CASE WHEN c."kind" = 'ORGANIZATION' THEN 'organization company' END,
      c."summary", c."whyInteresting", c."nextStep",
      (SELECT string_agg(ch."value" || ' ' || regexp_replace(ch."value", '[@./:_-]+', ' ', 'g'), ' ')
         FROM shared."contact_channel" ch WHERE ch."contactId" = c."id")
    ))) AS document
  ) d
  WHERE c."id" = target
  ON CONFLICT ("contactId") DO UPDATE
    SET "document" = EXCLUDED."document",
        "search_vector" = EXCLUDED."search_vector",
        "updatedAt" = EXCLUDED."updatedAt"
    WHERE "contact_search"."document" IS DISTINCT FROM EXCLUDED."document";
END;
$function$;

CREATE OR REPLACE FUNCTION shared.enforce_task_project_workspace_placement()
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
      RAISE EXCEPTION 'task projectId must reference a project in the same workspace as workspaceId'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.enqueue_calendar_feature_invalidation(old_workspace_id uuid, new_workspace_id uuid, old_project_id uuid, new_project_id uuid, invalidation_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF old_workspace_id IS NOT DISTINCT FROM new_workspace_id THEN
    IF new_workspace_id IS NOT NULL THEN
      PERFORM shared.enqueue_calendar_invalidation(
        new_workspace_id,
        old_project_id,
        new_project_id,
        invalidation_payload
      );
    END IF;
    RETURN;
  END IF;

  IF old_workspace_id IS NOT NULL THEN
    PERFORM shared.enqueue_calendar_invalidation(
      old_workspace_id,
      old_project_id,
      NULL,
      invalidation_payload
    );
  END IF;
  IF new_workspace_id IS NOT NULL THEN
    PERFORM shared.enqueue_calendar_invalidation(
      new_workspace_id,
      NULL,
      new_project_id,
      invalidation_payload
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.enqueue_calendar_invalidation(target_workspace_id uuid, old_project_id uuid, new_project_id uuid, invalidation_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  invalidation_id UUID := gen_random_uuid();
  transaction_dedupe_key TEXT;
  project_ids UUID[] := ARRAY(
    SELECT DISTINCT project_id
    FROM unnest(ARRAY[old_project_id, new_project_id]) AS project_id
    WHERE project_id IS NOT NULL
  );
  workspace_revision INTEGER;
BEGIN
  transaction_dedupe_key := txid_current()::TEXT || CASE
    WHEN invalidation_payload->>'kind' = 'calendar_access_revoked'
      THEN ':calendar-revoke:' || target_workspace_id::TEXT || ':' ||
        COALESCE(invalidation_payload->>'userId', invalidation_id::TEXT)
    ELSE ':calendar:' || target_workspace_id::TEXT
  END;

  -- One transaction can touch thousands of occurrence rows. Keep one durable
  -- workspace invalidation and merge the affected Project scopes into it.
  IF invalidation_payload->>'kind' = 'calendar_access_revoked' THEN
    PERFORM 1
    FROM shared."calendar_invalidation_outbox"
    WHERE "dedupeKey" = transaction_dedupe_key;
    IF FOUND THEN
      RETURN;
    END IF;
  ELSE
    UPDATE shared."calendar_invalidation_outbox" AS existing
    SET
      "projectId" = NULL,
      payload = existing.payload || jsonb_build_object(
        'kind', 'calendar_changed',
        'projectIds', ARRAY(
          SELECT DISTINCT project_id
          FROM (
            SELECT jsonb_array_elements_text(
              COALESCE(existing.payload->'projectIds', '[]'::JSONB)
            )::UUID AS project_id
            UNION ALL
            SELECT unnest(project_ids)
          ) AS affected_projects
        )
      )
    WHERE existing."dedupeKey" = transaction_dedupe_key;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  PERFORM 1
  FROM shared."workspace"
  WHERE id = target_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A global sequence gives every committed invalidation a monotonic token
  -- without taking parent-row locks after a Task/occurrence row is locked.
  workspace_revision := nextval(
    'shared.calendar_invalidation_revision_seq'
  );

  INSERT INTO shared."calendar_invalidation_outbox" (
    id,
    "createdAt",
    "workspaceId",
    "projectId",
    "dedupeKey",
    "calendarRevision",
    payload,
    attempts,
    "nextAttemptAt"
  ) VALUES (
    invalidation_id,
    CURRENT_TIMESTAMP,
    target_workspace_id,
    CASE
      WHEN old_project_id IS NOT DISTINCT FROM new_project_id
        THEN new_project_id
      ELSE NULL
    END,
    transaction_dedupe_key,
    workspace_revision,
    invalidation_payload || jsonb_build_object(
      'workspaceId', target_workspace_id,
      'calendarRevision', workspace_revision,
      'projectIds', project_ids
    ),
    0,
    CURRENT_TIMESTAMP
  );
END;
$function$;

CREATE OR REPLACE FUNCTION shared.erase_calendar_outbox_for_workspace_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM shared."calendar_invalidation_outbox"
  WHERE "workspaceId" = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.history_bucket_slug_from_metadata(metadata jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    shared.history_slugify(metadata ->> 'coworker_slug'),
    shared.history_slugify(metadata ->> 'coworker_name'),
    shared.history_slugify(metadata ->> 'model_name')
  );
$function$;

CREATE OR REPLACE FUNCTION shared.history_slugify(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(lower(btrim(value)), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_contact_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."followUpAt" IS NOT DISTINCT FROM NEW."followUpAt" THEN
      RETURN NULL;
    END IF;
  ELSIF COALESCE(NEW."followUpAt", OLD."followUpAt") IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM shared.enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    NULL,
    NULL,
    jsonb_build_object(
      'kind', 'contact_changed',
      'operation', lower(TG_OP),
      'contactId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_marketing_strategy_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_workspace_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."approvedAt" IS NULL THEN RETURN NULL; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD."approvedAt" IS NULL THEN RETURN NULL; END IF;
  ELSIF (OLD."approvedAt" IS NULL AND NEW."approvedAt" IS NULL)
    OR ROW(OLD."approvedAt", OLD.plan)
      IS NOT DISTINCT FROM ROW(NEW."approvedAt", NEW.plan) THEN
    RETURN NULL;
  END IF;

  SELECT "workspaceId" INTO target_workspace_id
  FROM shared."project"
  WHERE id = COALESCE(NEW."projectId", OLD."projectId");
  IF target_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM shared.enqueue_calendar_invalidation(
    target_workspace_id,
    COALESCE(NEW."projectId", OLD."projectId"),
    NULL,
    jsonb_build_object(
      'kind', 'marketing_strategy_changed',
      'operation', lower(TG_OP),
      'strategyId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_marketing_strategy_file_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  strategy_id UUID := COALESCE(NEW."marketingStrategyId", OLD."marketingStrategyId");
  target_workspace_id UUID;
  target_project_id UUID;
BEGIN
  SELECT project.id, project."workspaceId"
  INTO target_project_id, target_workspace_id
  FROM shared."marketing_strategy" AS strategy
  JOIN shared."project" ON project.id = strategy."projectId"
  WHERE strategy.id = strategy_id AND strategy."approvedAt" IS NOT NULL;
  IF target_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM shared.enqueue_calendar_invalidation(
    target_workspace_id,
    target_project_id,
    NULL,
    jsonb_build_object(
      'kind', 'marketing_strategy_changed',
      'operation', lower(TG_OP),
      'strategyId', strategy_id
    )
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_newsletter_issue_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."scheduledAt", OLD."sentAt", OLD.status, OLD.subject,
    OLD."projectId", OLD."workspaceId"
  ) IS NOT DISTINCT FROM ROW(
    NEW."scheduledAt", NEW."sentAt", NEW.status, NEW.subject,
    NEW."projectId", NEW."workspaceId"
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM shared.enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."projectId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."projectId" END,
    jsonb_build_object(
      'kind', 'newsletter_issue_changed',
      'operation', lower(TG_OP),
      'issueId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_project_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  workspace_id UUID;
  project_id UUID;
  old_project_id UUID;
  new_project_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD.name, OLD.logo, OLD."closingAt", OLD."closedAt"
  ) IS NOT DISTINCT FROM ROW(
    NEW.name, NEW.logo, NEW."closingAt", NEW."closedAt"
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    workspace_id := OLD."workspaceId";
    project_id := OLD.id;
  ELSIF TG_OP = 'INSERT' THEN
    workspace_id := NEW."workspaceId";
    project_id := NEW.id;
    new_project_id := NEW.id;
  ELSE
    workspace_id := NEW."workspaceId";
    project_id := NEW.id;
    old_project_id := OLD.id;
    new_project_id := NEW.id;
  END IF;

  PERFORM shared.enqueue_calendar_invalidation(
    workspace_id,
    old_project_id,
    new_project_id,
    jsonb_build_object(
      'kind', 'project_changed',
      'operation', lower(TG_OP),
      'projectId', project_id,
      'before', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object(
        'name', OLD.name,
        'logoUrl', OLD.logo,
        'closingAt', OLD."closingAt",
        'closedAt', OLD."closedAt"
      ) END,
      'after', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object(
        'name', NEW.name,
        'logoUrl', NEW.logo,
        'closingAt', NEW."closingAt",
        'closedAt', NEW."closedAt"
      ) END
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_run_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  workspace_id UUID;
  old_workspace_id UUID;
  new_workspace_id UUID;
  old_project_id UUID;
  new_project_id UUID;
  run_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."scheduleId", OLD."releasedTaskId", OLD."epochId",
    OLD."originalScheduledAt", OLD."effectiveScheduledAt", OLD.state,
    OLD."sourceWorkspaceId", OLD."sourceType", OLD."sourceProjectId",
    OLD."actorUserId"
  ) IS NOT DISTINCT FROM ROW(
    NEW."scheduleId", NEW."releasedTaskId", NEW."epochId",
    NEW."originalScheduledAt", NEW."effectiveScheduledAt", NEW.state,
    NEW."sourceWorkspaceId", NEW."sourceType", NEW."sourceProjectId",
    NEW."actorUserId"
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    old_workspace_id := OLD."sourceWorkspaceId";
    old_project_id := OLD."sourceProjectId";
    run_id := OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_workspace_id := NEW."sourceWorkspaceId";
    new_project_id := NEW."sourceProjectId";
    run_id := NEW.id;
  END IF;

  IF old_workspace_id IS DISTINCT FROM new_workspace_id THEN
    IF old_workspace_id IS NOT NULL THEN
      PERFORM shared.enqueue_calendar_invalidation(
        old_workspace_id,
        old_project_id,
        NULL,
        jsonb_build_object(
          'kind', 'occurrence_changed',
          'operation', lower(TG_OP),
          'occurrenceId', run_id
        )
      );
    END IF;

    IF new_workspace_id IS NOT NULL THEN
      PERFORM shared.enqueue_calendar_invalidation(
        new_workspace_id,
        NULL,
        new_project_id,
        jsonb_build_object(
          'kind', 'occurrence_changed',
          'operation', lower(TG_OP),
          'occurrenceId', run_id
        )
      );
    END IF;
  ELSE
    workspace_id := COALESCE(new_workspace_id, old_workspace_id);
    PERFORM shared.enqueue_calendar_invalidation(
      workspace_id,
      old_project_id,
      new_project_id,
      jsonb_build_object(
        'kind', 'occurrence_changed',
        'operation', lower(TG_OP),
        'occurrenceId', run_id
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_social_post_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."scheduledAt", OLD.status, OLD."projectId", OLD."workspaceId",
    OLD.text, OLD.provider, OLD.revision, OLD."socialConnectionId",
    OLD."quotedPostId", OLD."needsAttentionReason"
  ) IS NOT DISTINCT FROM ROW(
    NEW."scheduledAt", NEW.status, NEW."projectId", NEW."workspaceId",
    NEW.text, NEW.provider, NEW.revision, NEW."socialConnectionId",
    NEW."quotedPostId", NEW."needsAttentionReason"
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM shared.enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."projectId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."projectId" END,
    jsonb_build_object(
      'kind', 'social_post_changed',
      'operation', lower(TG_OP),
      'socialPostId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  task_id TEXT;
  workspace_id UUID;
  old_workspace_id UUID;
  new_workspace_id UUID;
  old_project_id UUID;
  new_project_id UUID;
  calendar_relevant BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    task_id := NEW.id;
    new_workspace_id := NEW."workspaceId";
    new_project_id := NEW."projectId";
    calendar_relevant := NEW."runAt" IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    task_id := OLD.id;
    old_workspace_id := OLD."workspaceId";
    old_project_id := OLD."projectId";
    calendar_relevant := OLD."runAt" IS NOT NULL;
  ELSE
    task_id := NEW.id;
    old_workspace_id := OLD."workspaceId";
    new_workspace_id := NEW."workspaceId";
    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    IF ROW(
      OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.name,
      OLD.status, OLD."assigneeId", OLD."assigneeUserId", OLD."assigneeSokoBotId",
      OLD."archivedAt", OLD."runAt"
    ) IS NOT DISTINCT FROM ROW(
      NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.name,
      NEW.status, NEW."assigneeId", NEW."assigneeUserId", NEW."assigneeSokoBotId",
      NEW."archivedAt", NEW."runAt"
    ) THEN
      RETURN NEW;
    END IF;
    calendar_relevant := OLD."runAt" IS NOT NULL OR NEW."runAt" IS NOT NULL;
  END IF;

  IF NOT calendar_relevant THEN
    SELECT EXISTS (
      SELECT 1
      FROM shared."task_schedule_run"
      WHERE "releasedTaskId" = task_id
    ) INTO calendar_relevant;
  END IF;

  IF calendar_relevant AND old_workspace_id IS DISTINCT FROM new_workspace_id THEN
    IF old_workspace_id IS NOT NULL THEN
      PERFORM shared.enqueue_calendar_invalidation(
        old_workspace_id,
        old_project_id,
        NULL,
        jsonb_build_object(
          'kind', 'task_changed',
          'operation', lower(TG_OP),
          'taskId', task_id
        )
      );
    END IF;

    IF new_workspace_id IS NOT NULL THEN
      PERFORM shared.enqueue_calendar_invalidation(
        new_workspace_id,
        NULL,
        new_project_id,
        jsonb_build_object(
          'kind', 'task_changed',
          'operation', lower(TG_OP),
          'taskId', task_id
        )
      );
    END IF;
  ELSIF calendar_relevant THEN
    workspace_id := COALESCE(new_workspace_id, old_workspace_id);
    PERFORM shared.enqueue_calendar_invalidation(
      workspace_id,
      old_project_id,
      new_project_id,
      jsonb_build_object(
        'kind', 'task_changed',
        'operation', lower(TG_OP),
        'taskId', task_id
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_calendar_for_task_schedule_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF ROW(
    OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.state,
    OLD.visibility, OLD.name, OLD."assigneeId", OLD."assigneeSokoBotId",
    OLD."assigneeUserId", OLD.revision
  ) IS NOT DISTINCT FROM ROW(
    NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.state,
    NEW.visibility, NEW.name, NEW."assigneeId", NEW."assigneeSokoBotId",
    NEW."assigneeUserId", NEW.revision
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM shared.enqueue_calendar_invalidation(
    NEW."workspaceId",
    OLD."projectId",
    NEW."projectId",
    jsonb_build_object(
      'kind', 'task_schedule_changed',
      'operation', 'update',
      'scheduleId', NEW.id
    )
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_changed_workspace_tag_offers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM shared."task_workspace_tag_decision" WHERE "labelId" = NEW.id AND state = 'JEV_SUGGESTED';
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.invalidate_task_workspace_tag_suggestions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM shared."task_workspace_tag" WHERE "taskId" = NEW.id AND state = 'JEV_ADDED';
    DELETE FROM shared."task_workspace_tag_decision" WHERE "taskId" = NEW.id AND state = 'JEV_SUGGESTED';
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.project_alias_old_identifier()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM shared."project_identifier_alias"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "identifier" = NEW."identifier"
    AND "projectId" = NEW."id";

  INSERT INTO shared."project_identifier_alias" ("workspaceId", "identifier", "projectId")
  VALUES (OLD."workspaceId", OLD."identifier", OLD."id");

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.project_default_identifier(p_name text, p_workspace_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  base TEXT := regexp_replace(upper(normalize(p_name, NFD)), '[^A-Z0-9]', '', 'g');
  candidate TEXT;
  suffix INTEGER := 1;
BEGIN
  IF base = '' THEN
    base := 'PRJ';
  ELSIF base ~ '^[0-9]' THEN
    base := 'P' || base;
  END IF;
  base := left(base, 3);
  IF length(base) < 2 THEN
    base := rpad(base, 2, 'X');
  END IF;
  candidate := base;
  PERFORM pg_advisory_xact_lock(hashtextextended('project_identifier:' || p_workspace_id::TEXT, 0));
  WHILE EXISTS (
    SELECT 1 FROM shared."project"
    WHERE "workspaceId" = p_workspace_id AND "identifier" = candidate
    UNION ALL
    SELECT 1 FROM shared."project_identifier_alias"
    WHERE "workspaceId" = p_workspace_id AND "identifier" = candidate
  ) LOOP
    suffix := suffix + 1;
    candidate := left(base, 7 - length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;
  RETURN candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.project_set_identifier()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."identifier" IS NOT DISTINCT FROM OLD."identifier" THEN
    RETURN NEW;
  END IF;

  IF NEW."identifier" IS NULL THEN
    NEW."identifier" := shared.project_default_identifier(NEW."name", NEW."workspaceId");
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended('project_identifier:' || NEW."workspaceId"::TEXT, 0)
    );
  END IF;

  -- Re-insert the existing alias row so the primary key fails. Pointing the
  -- row at NEW."id" would also fail the project foreign key during INSERT,
  -- before that project row exists.
  INSERT INTO shared."project_identifier_alias" ("workspaceId", "identifier", "projectId")
  SELECT retired."workspaceId", retired."identifier", retired."projectId"
  FROM shared."project_identifier_alias" AS retired
  WHERE retired."workspaceId" = NEW."workspaceId"
    AND retired."identifier" = NEW."identifier"
    AND retired."projectId" IS DISTINCT FROM NEW."id";

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.reject_soko_bot_admin_action_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'soko_bot_admin_action is append-only; % is forbidden', TG_OP
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$function$;

CREATE OR REPLACE FUNCTION shared.social_post_quote_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE shared."social_post"
    SET "needsAttentionReason" = 'The quoted post was cancelled',
        "lastError" = 'The quoted post was cancelled',
        "status" = CASE WHEN "status" IN ('DRAFT', 'NEEDS_APPROVAL', 'CANCELED') THEN "status" ELSE 'FAILED'::shared."SocialPostStatus" END,
        "nextAttemptAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "revision" = CASE WHEN "status" = 'CANCELED' THEN "revision" ELSE "revision" + 1 END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "quotedPostId" = OLD."id"
      AND "publishedExternalId" IS NULL
      AND "status" <> 'PUBLISHED';
    RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.task_alias_old_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO shared."task_identifier_alias" ("projectId", "number", "taskId")
  SELECT OLD."projectId", OLD."number", NEW."id"
  WHERE EXISTS (SELECT 1 FROM shared."project" WHERE "id" = OLD."projectId")
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.task_assign_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."projectId" IS NULL THEN
    NEW."number" := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
    UPDATE shared."project" SET "taskCounter" = "taskCounter" + 1
    WHERE "id" = NEW."projectId"
    RETURNING "taskCounter" INTO NEW."number";
  ELSE
    NEW."number" := OLD."number";
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.task_subtask_follow_parent()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE shared."task"
  SET "projectId" = NEW."projectId",
    "workspaceId" = NEW."workspaceId",
    "visibility" = NEW."visibility"
  WHERE "parentTaskId" = NEW."id"
    AND ("projectId" IS DISTINCT FROM NEW."projectId"
      OR "workspaceId" IS DISTINCT FROM NEW."workspaceId"
      OR "visibility" IS DISTINCT FROM NEW."visibility");
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.task_subtask_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  max_depth CONSTANT INTEGER := 5;
  parent RECORD;
  ancestor_id TEXT;
  -- The number of Tasks from the new parent up to its root: the level this
  -- Task takes under the new parent.
  task_level INTEGER := 0;
  subtree_height INTEGER := 0;
BEGIN
  IF NEW."parentTaskId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "workspaceId", "projectId", "visibility", "ownerId"
  INTO parent FROM shared."task" WHERE "id" = NEW."parentTaskId";

  IF NEW."workspaceId" IS DISTINCT FROM parent."workspaceId"
    OR NEW."projectId" IS DISTINCT FROM parent."projectId"
    OR NEW."visibility" IS DISTINCT FROM parent."visibility" THEN
    RAISE EXCEPTION 'task_subtask_parent_mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."parentTaskId" IS NOT DISTINCT FROM OLD."parentTaskId" THEN
    RETURN NEW;
  END IF;

  IF parent."visibility" = 'PRIVATE' AND NEW."ownerId" IS DISTINCT FROM parent."ownerId" THEN
    RAISE EXCEPTION 'task_subtask_private_owner' USING ERRCODE = '23514';
  END IF;

  -- Walk up from the new parent. Stored chains are at most max_depth + 1
  -- Tasks long, so the bound stops the walk before it can loop. The cycle
  -- check runs first: the Task itself is never more than max_depth steps up.
  ancestor_id := NEW."parentTaskId";
  WHILE ancestor_id IS NOT NULL LOOP
    IF ancestor_id = NEW."id" THEN
      RAISE EXCEPTION 'task_subtask_cycle' USING ERRCODE = '23514';
    END IF;
    task_level := task_level + 1;
    IF task_level > max_depth THEN
      RAISE EXCEPTION 'task_subtask_too_deep' USING ERRCODE = '23514';
    END IF;
    SELECT "parentTaskId" INTO ancestor_id FROM shared."task" WHERE "id" = ancestor_id;
  END LOOP;

  -- A new row has no sub-tasks yet. A moved Task brings its whole tree.
  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE subtree AS (
      SELECT "id", 0 AS height FROM shared."task" WHERE "id" = NEW."id"
      UNION ALL
      SELECT t."id", subtree.height + 1
      FROM shared."task" t JOIN subtree ON t."parentTaskId" = subtree."id"
      WHERE subtree.height < max_depth
    )
    SELECT max(height) INTO subtree_height FROM subtree;
  END IF;

  IF task_level + subtree_height > max_depth THEN
    RAISE EXCEPTION 'task_subtask_too_deep' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.task_tag_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."tagClassificationState" := 'pending';
  ELSIF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
    NEW."tagContentRevision" := OLD."tagContentRevision" + 1;
    NEW."previousAutomaticTags" := CASE
      WHEN cardinality(OLD."automaticTags") > 0 THEN OLD."automaticTags"
      WHEN OLD."tagClassificationState" IN ('pending', 'running')
        THEN OLD."previousAutomaticTags"
      ELSE ARRAY[]::TEXT[]
    END;
    NEW."automaticTags" := ARRAY[]::TEXT[];
    NEW."tagClassificationState" := 'pending';
    NEW."tagClassificationAttempts" := 0;
    NEW."tagClassificationLease" := NULL;
    NEW."tagClassificationAvailableAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$function$;
