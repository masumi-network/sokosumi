-- Run with psql -v ON_ERROR_STOP=1 -f this-file.sql against a disposable
-- database that has every migration before 20260924120000 applied, e.g. from
-- packages/database/prisma:
--
--   for m in migrations/2*/; do
--     [[ "$m" < migrations/20260924120000 ]] &&
--       psql "$DB" -q -v ON_ERROR_STOP=1 -f "$m/migration.sql"
--   done
--
-- The cutover (ADR 0041) moves every live series into a Task Schedule. It
-- commits on its own, so this file leaves its fixtures behind.
\set ON_ERROR_STOP 1
\set QUIET 1

DO $$
BEGIN
  IF to_regclass('"task_schedule_occurrence"') IS NULL THEN
    RAISE EXCEPTION 'Needs a database migrated up to, not including, 20260924120000_task_schedule_cutover';
  END IF;
  IF EXISTS (SELECT FROM "task_schedule") OR EXISTS (SELECT FROM "task") THEN
    RAISE EXCEPTION 'Needs an empty disposable database: the cutover commits, so the fixtures stay';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect(ok BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Task Schedule cutover: %', message;
  END IF;
END;
$$;

-- Fixtures ------------------------------------------------------------------

INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES
  ('owner', 'Owner', 'owner@example.com', true, now(), now()),
  ('person', 'Person', 'person@example.com', true, now(), now());

INSERT INTO "workspace" (id, "updatedAt", "userId") VALUES
  ('11111111-1111-4111-8111-111111111111', now(), 'owner');

INSERT INTO "project" (id, "updatedAt", "workspaceId", name) VALUES
  ('22222222-2222-4222-8222-222222222222', now(), '11111111-1111-4111-8111-111111111111', 'Reports');

INSERT INTO "soko_bot" (id, "updatedAt", "userId", "workspaceId") VALUES
  ('33333333-3333-4333-8333-333333333333', now(), 'owner', '11111111-1111-4111-8111-111111111111');

INSERT INTO "task" (
  id, "updatedAt", "createdAt", "ownerId", "creatorUserId", "workspaceId",
  "projectId", name, description, status, visibility, "assigneeUserId",
  metadata, "nextRunAt", "archivedAt"
) VALUES
  -- v1: three Runs left, two releases so far (one of them released twice).
  ('v1', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'Weekly v1', 'Blueprint text', 'QUEUED', 'PUBLIC', 'person',
   '{"version":1,"mode":"recurring","scheduledAt":"2026-09-01T00:00:00.000Z","expr":"0 9 * * 1","timezone":"Europe/Berlin","endsMode":"after","occurrences":3}',
   '2030-01-07 08:00', NULL),
  ('v1-release-a', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'Weekly v1', NULL, 'COMPLETED', 'PUBLIC', 'person', NULL, NULL, NULL),
  ('v1-release-b', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'Weekly v1', NULL, 'READY', 'PUBLIC', 'person', NULL, NULL, NULL),
  ('v1-release-dup', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'Weekly v1', NULL, 'READY', 'PUBLIC', 'person', NULL, NULL, NULL),
  -- v2 with a skipped and a moved Run; the next run is the moved one.
  ('v2', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Daily v2', NULL, 'QUEUED', 'PRIVATE', NULL,
   '{"version":2,"mode":"recurring","epochId":"e2e2e2e2-0000-4000-8000-000000000002","createdAt":"2026-09-01T00:00:00.000Z","ruleEffectiveFrom":"2026-09-01T00:00:00.000Z","timezone":"UTC","expr":"0 9 * * *","endsMode":"never","epochReleaseCount":1,"anchorAt":"2026-09-01T00:00:00.000Z"}',
   '2030-01-02 09:00', NULL),
  ('v2-release', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Daily v2', NULL, 'COMPLETED', 'PRIVATE', NULL, NULL, NULL, NULL),
  -- v2 ending after four Runs, one released, and no planned Run written.
  ('v2-after', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Four times', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":2,"mode":"recurring","epochId":"e3e3e3e3-0000-4000-8000-000000000003","createdAt":"2026-09-01T00:00:00.000Z","ruleEffectiveFrom":"2026-09-01T00:00:00.000Z","timezone":"UTC","expr":"0 9 1 * *","endsMode":"after","targetReleaseCount":4,"epochReleaseCount":1,"anchorAt":"2026-09-01T00:00:00.000Z"}',
   '2030-03-01 09:00', NULL),
  ('v2-after-release', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Four times', NULL, 'COMPLETED', 'PUBLIC', NULL, NULL, NULL, NULL),
  ('quarantined', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Quarantined', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":2,"mode":"recurring","epochId":"e4e4e4e4-0000-4000-8000-000000000004","createdAt":"2026-09-01T00:00:00.000Z","ruleEffectiveFrom":"2026-09-01T00:00:00.000Z","timezone":"Mars/Olympus","expr":"0 9 * * *","endsMode":"never","epochReleaseCount":0,"anchorAt":"2026-09-01T00:00:00.000Z"}',
   '2030-01-01 09:00', NULL),
  -- A person-assigned series never left Ready, so it never released.
  ('person-ready', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Person series', NULL, 'READY', 'PUBLIC', 'person',
   '{"version":1,"mode":"recurring","scheduledAt":"2026-09-01T00:00:00.000Z","expr":"0 9 * * *","intervalDays":3,"anchorAt":"2026-09-02T09:00:00.000Z"}',
   '2030-01-01 09:00', NULL),
  ('once-v2', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Once v2', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":2,"mode":"once","epochId":"e5e5e5e5-0000-4000-8000-000000000005","createdAt":"2026-09-01T00:00:00.000Z","ruleEffectiveFrom":"2026-09-01T00:00:00.000Z","timezone":"UTC","sourceRunAt":"2030-02-01T09:00:00.000Z","effectiveRunAt":"2030-02-01T10:00:00.000Z"}',
   '2030-02-01 10:00', NULL),
  ('once-v1', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Once v1', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":1,"mode":"once","scheduledAt":"2026-09-01T00:00:00.000Z","runAt":"2030-02-02T08:30:00.000Z"}',
   '2030-02-02 08:30', NULL),
  -- Released under the old rule: its ledger row points at itself.
  ('once-released', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Once released', NULL, 'READY', 'PUBLIC', NULL, NULL, NULL, NULL),
  ('archived', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Archived series', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":2,"mode":"recurring","epochId":"e6e6e6e6-0000-4000-8000-000000000006","createdAt":"2026-09-01T00:00:00.000Z","ruleEffectiveFrom":"2026-09-01T00:00:00.000Z","timezone":"UTC","expr":"0 9 * * *","endsMode":"never","epochReleaseCount":0,"anchorAt":"2026-09-01T00:00:00.000Z"}',
   '2030-01-01 09:00', '2026-09-10'),
  -- A legacy "every 3 days" rule written as a cron, without intervalDays.
  ('cron-interval', now(), '2026-09-01', 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Every third day', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":1,"mode":"recurring","scheduledAt":"2026-09-01T09:00:00.000Z","expr":"0 9 */3 * *","timezone":"UTC"}',
   '2030-01-02 09:00', NULL),
  -- Quarantined one-time: left for operator repair, ledger rows included.
  ('once-quarantined', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Once quarantined', NULL, 'QUEUED', 'PUBLIC', NULL,
   '{"version":2,"mode":"once","epochId":"e8e8e8e8-0000-4000-8000-000000000008","createdAt":"2026-09-01T00:00:00.000Z","ruleEffectiveFrom":"2026-09-01T00:00:00.000Z","timezone":"UTC","sourceRunAt":"2030-02-03T09:00:00.000Z","effectiveRunAt":"2030-02-03T09:00:00.000Z"}',
   '2030-02-03 09:00', NULL),
  ('not-a-schedule', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Other metadata', NULL, 'READY', 'PUBLIC', NULL, '{"design":"md"}', NULL, NULL),
  ('malformed', now(), now(), 'owner', 'owner', '11111111-1111-4111-8111-111111111111',
   NULL, 'Malformed', NULL, 'READY', 'PUBLIC', NULL, 'not json', NULL, NULL);

INSERT INTO "task_schedule_quarantine" (id, "updatedAt", "taskId", reason, details, "capturedStatus") VALUES
  ('99999999-9999-4999-8999-999999999999', now(), 'quarantined', 'INVALID_TIMEZONE', 'Unknown timezone', 'QUEUED'),
  ('99999999-9999-4999-8999-999999999998', now(), 'once-quarantined', 'NEXT_RUN_MISMATCH', 'Next run differs', 'QUEUED');

-- A Soko Bot assignee carries over like any other.
UPDATE "task" SET "assigneeSokoBotId" = '33333333-3333-4333-8333-333333333333' WHERE id = 'v2-after';

INSERT INTO "task_link" (id, "updatedAt", "fromTaskId", "toTaskId", type) VALUES
  ('link-v1-a', now(), 'v1', 'v1-release-a', 'SCHEDULE'),
  ('link-v1-b', now(), 'v1', 'v1-release-b', 'SCHEDULE'),
  ('link-v1-dup', now(), 'v1', 'v1-release-dup', 'SCHEDULE'),
  ('link-v2', now(), 'v2', 'v2-release', 'SCHEDULE'),
  ('link-v2-after', now(), 'v2-after', 'v2-after-release', 'SCHEDULE'),
  ('link-relates', now(), 'v1', 'v2', 'RELATES');

-- Ledger rows, by parent.
INSERT INTO "task_schedule_occurrence" (
  id, "updatedAt", "seriesTaskId", "releasedTaskId", "epochId",
  "originalScheduledAt", "effectiveScheduledAt", "legacyLinkId", state,
  "scheduleVersion", "sourceWorkspaceId", "sourceType", "sourceProjectId",
  "sourceAccuracy", "timeAccuracy", timezone, "ruleSnapshot", "actorUserId"
) VALUES
  -- v1: two approximate releases at the same time, one at a later time, and
  -- two planned rows at the rule's next times.
  ('a0000000-0000-4000-8000-000000000001', now(), 'v1', 'v1-release-a', NULL,
   NULL, '2026-09-07 07:00', 'link-v1-a', 'RELEASED',
   1, '11111111-1111-4111-8111-111111111111', 'PROJECT', '22222222-2222-4222-8222-222222222222',
   'INFERRED', 'APPROXIMATE', 'Europe/Berlin', '{}', NULL),
  ('a0000000-0000-4000-8000-000000000002', now(), 'v1', 'v1-release-dup', NULL,
   NULL, '2026-09-07 07:00', 'link-v1-dup', 'RELEASED',
   1, '11111111-1111-4111-8111-111111111111', 'LEGACY_UNKNOWN', NULL,
   'UNKNOWN', 'APPROXIMATE', NULL, NULL, NULL),
  ('a0000000-0000-4000-8000-000000000003', now(), 'v1', 'v1-release-b', NULL,
   NULL, '2026-09-14 07:00', 'link-v1-b', 'RELEASED',
   1, '11111111-1111-4111-8111-111111111111', 'PROJECT', '22222222-2222-4222-8222-222222222222',
   'INFERRED', 'APPROXIMATE', 'Europe/Berlin', '{}', NULL),
  ('a0000000-0000-4000-8000-000000000004', now(), 'v1', NULL, NULL,
   '2030-01-07 08:00', '2030-01-07 08:00', NULL, 'PLANNED',
   1, '11111111-1111-4111-8111-111111111111', 'PROJECT', '22222222-2222-4222-8222-222222222222',
   'EXACT', 'EXACT', 'Europe/Berlin', '{"scheduledAt":"2026-09-01T00:00:00.000Z"}', NULL),
  ('a0000000-0000-4000-8000-000000000005', now(), 'v1', NULL, NULL,
   '2030-01-14 08:00', '2030-01-14 08:00', NULL, 'PLANNED',
   1, '11111111-1111-4111-8111-111111111111', 'PROJECT', '22222222-2222-4222-8222-222222222222',
   'EXACT', 'EXACT', 'Europe/Berlin', '{"scheduledAt":"2026-09-01T00:00:00.000Z"}', NULL),
  -- v2 current epoch: released, skipped, moved earlier, planned, and a stale
  -- planned row before the next run.
  ('b0000000-0000-4000-8000-000000000001', now(), 'v2', 'v2-release', 'e2e2e2e2-0000-4000-8000-000000000002',
   '2026-09-02 09:00', '2026-09-02 09:00', NULL, 'RELEASED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('b0000000-0000-4000-8000-000000000002', now(), 'v2', NULL, 'e2e2e2e2-0000-4000-8000-000000000002',
   '2030-01-01 09:00', '2030-01-01 09:00', NULL, 'SKIPPED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, 'person'),
  ('b0000000-0000-4000-8000-000000000003', now(), 'v2', NULL, 'e2e2e2e2-0000-4000-8000-000000000002',
   '2030-01-03 09:00', '2030-01-02 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, 'person'),
  ('b0000000-0000-4000-8000-000000000004', now(), 'v2', NULL, 'e2e2e2e2-0000-4000-8000-000000000002',
   '2030-01-04 09:00', '2030-01-04 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('b0000000-0000-4000-8000-000000000005', now(), 'v2', NULL, 'e2e2e2e2-0000-4000-8000-000000000002',
   '2029-12-31 09:00', '2029-12-31 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  -- v2 old epoch: an ordinary and a moved planned row the old release would
  -- never have released.
  ('b0000000-0000-4000-8000-000000000006', now(), 'v2', NULL, 'e0e0e0e0-0000-4000-8000-000000000000',
   '2030-01-05 09:00', '2030-01-05 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('b0000000-0000-4000-8000-000000000007', now(), 'v2', NULL, 'e0e0e0e0-0000-4000-8000-000000000000',
   '2030-01-06 09:00', '2030-01-06 12:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000001', now(), 'v2-after', 'v2-after-release', 'e3e3e3e3-0000-4000-8000-000000000003',
   '2026-09-01 09:00', '2026-09-01 09:00', NULL, 'RELEASED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  -- Quarantined: a pause keeps the skip and drops the ordinary planned row.
  ('d0000000-0000-4000-8000-000000000001', now(), 'quarantined', NULL, 'e4e4e4e4-0000-4000-8000-000000000004',
   '2030-01-01 09:00', '2030-01-01 09:00', NULL, 'SKIPPED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('d0000000-0000-4000-8000-000000000002', now(), 'quarantined', NULL, 'e4e4e4e4-0000-4000-8000-000000000004',
   '2030-01-02 09:00', '2030-01-02 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('e0000000-0000-4000-8000-000000000001', now(), 'once-v2', NULL, 'e5e5e5e5-0000-4000-8000-000000000005',
   '2030-02-01 09:00', '2030-02-01 10:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('e0000000-0000-4000-8000-000000000002', now(), 'once-released', 'once-released', 'e7e7e7e7-0000-4000-8000-000000000007',
   '2026-09-03 09:00', '2026-09-03 09:00', NULL, 'RELEASED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('f0000000-0000-4000-8000-000000000001', now(), 'archived', NULL, 'e6e6e6e6-0000-4000-8000-000000000006',
   '2030-01-01 09:00', '2030-01-01 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('f0000000-0000-4000-8000-000000000002', now(), 'once-quarantined', NULL, 'e8e8e8e8-0000-4000-8000-000000000008',
   '2030-02-03 09:00', '2030-02-03 09:00', NULL, 'PLANNED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL),
  ('f0000000-0000-4000-8000-000000000003', now(), 'once-quarantined', 'once-quarantined', 'e8e8e8e8-0000-4000-8000-000000000008',
   '2026-09-04 09:00', '2026-09-04 09:00', NULL, 'RELEASED',
   2, '11111111-1111-4111-8111-111111111111', 'WORKSPACE', NULL, 'EXACT', 'EXACT', 'UTC', NULL, NULL);

-- Cutover -------------------------------------------------------------------

\ir ../migrations/20260924120000_task_schedule_cutover/migration.sql

-- Schedules -----------------------------------------------------------------

DO $$
DECLARE
  s RECORD;
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task_schedule") = 6,
    'every live series becomes one schedule; archived and one-time do not'
  );

  SELECT * INTO s FROM "task_schedule" WHERE name = 'Every third day';
  PERFORM pg_temp.expect(
    s.state = 'ACTIVE'
      AND s.expr = '0 9 */3 * *'
      AND s."intervalDays" = 3
      AND s."anchorAt" = '2026-09-01 09:00',
    'a legacy "*/N" day cron keeps running every N days from its anchor'
  );

  SELECT * INTO s FROM "task_schedule" WHERE name = 'Weekly v1';
  PERFORM pg_temp.expect(s.state = 'ACTIVE', 'a Queued v1 series is Active');
  PERFORM pg_temp.expect(
    s.expr = '0 9 * * 1' AND s.timezone = 'Europe/Berlin' AND s."intervalDays" IS NULL,
    'v1 rule carries over'
  );
  PERFORM pg_temp.expect(
    s."anchorAt" = '2026-09-01 00:00' AND s."ruleEffectiveFrom" = '2026-09-01 00:00',
    'v1 without an anchor anchors at scheduledAt'
  );
  PERFORM pg_temp.expect(
    s."endsMode" = 'AFTER' AND s."targetRunCount" = 6 AND s."releasedCount" = 3,
    'v1 remaining occurrences plus released links make the target: ' || s."targetRunCount" || '/' || s."releasedCount"
  );
  PERFORM pg_temp.expect(s."nextRunAt" = '2030-01-07 08:00', 'v1 next run is the Task''s');
  PERFORM pg_temp.expect(
    s.description = 'Blueprint text'
      AND s."projectId" = '22222222-2222-4222-8222-222222222222'
      AND s."assigneeUserId" = 'person'
      AND s."ownerId" = 'owner'
      AND s."creatorUserId" = 'owner'
      AND s."workspaceId" = '11111111-1111-4111-8111-111111111111'
      AND s.visibility = 'PUBLIC'
      AND s."createdAt" = '2026-09-01',
    'v1 blueprint comes from the template'
  );

  SELECT * INTO s FROM "task_schedule" WHERE name = 'Daily v2';
  PERFORM pg_temp.expect(s.state = 'ACTIVE', 'a Queued v2 series is Active');
  PERFORM pg_temp.expect(
    s."epochId" = 'e2e2e2e2-0000-4000-8000-000000000002'
      AND s."endsMode" = 'NEVER'
      AND s."releasedCount" = 1
      AND s.visibility = 'PRIVATE'
      AND s."projectId" IS NULL,
    'v2 keeps its epoch, counts, and blueprint'
  );
  PERFORM pg_temp.expect(s."nextRunAt" = '2030-01-02 09:00', 'v2 next run is the moved Run');

  SELECT * INTO s FROM "task_schedule" WHERE name = 'Four times';
  PERFORM pg_temp.expect(
    s.state = 'ACTIVE' AND s."endsMode" = 'AFTER' AND s."targetRunCount" = 4 AND s."releasedCount" = 1
      AND s."assigneeSokoBotId" = '33333333-3333-4333-8333-333333333333',
    'v2 end-after counts and a Soko Bot assignee carry over as is'
  );

  SELECT * INTO s FROM "task_schedule" WHERE name = 'Quarantined';
  PERFORM pg_temp.expect(
    s.state = 'PAUSED' AND s."nextRunAt" IS NULL AND s.timezone = 'Mars/Olympus',
    'a quarantined series is Paused with its rule as it was'
  );

  SELECT * INTO s FROM "task_schedule" WHERE name = 'Person series';
  PERFORM pg_temp.expect(
    s.state = 'PAUSED'
      AND s."nextRunAt" IS NULL
      AND s."assigneeUserId" = 'person'
      AND s."intervalDays" = 3
      AND s."anchorAt" = '2026-09-02 09:00'
      AND s."releasedCount" = 0,
    'a person-assigned series left in Ready is Paused'
  );
END;
$$;

-- Runs ----------------------------------------------------------------------

DO $$
DECLARE
  v1 "task_schedule"%ROWTYPE;
  v2 "task_schedule"%ROWTYPE;
  quarantined "task_schedule"%ROWTYPE;
BEGIN
  SELECT * INTO v1 FROM "task_schedule" WHERE name = 'Weekly v1';
  SELECT * INTO v2 FROM "task_schedule" WHERE name = 'Daily v2';
  SELECT * INTO quarantined FROM "task_schedule" WHERE name = 'Quarantined';

  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1 FROM "task_schedule_run"
      WHERE "scheduleId" IS NOT NULL
        AND (
          "scheduleVersion" <> 2 OR "legacyLinkId" IS NOT NULL OR "epochId" IS NULL
          OR "originalScheduledAt" IS NULL OR timezone IS NULL
          OR "timeAccuracy" <> 'EXACT' OR "sourceAccuracy" <> 'EXACT'
          OR "seriesTaskId" IS NOT NULL
        )
    ),
    'every re-parented Run has the Task Schedule shape'
  );

  -- v1: three released, two planned, all under the schedule.
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task_schedule_run" WHERE "scheduleId" = v1.id AND state = 'RELEASED') = 3
      AND (SELECT count(*) FROM "task_schedule_run" WHERE "scheduleId" = v1.id AND state = 'PLANNED') = 2,
    'v1 released and planned rows re-parent'
  );
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task_schedule_run" WHERE "scheduleId" = v1.id AND state = 'PLANNED' AND "epochId" = v1."epochId") = 2,
    'v1 planned rows join the schedule''s epoch'
  );
  PERFORM pg_temp.expect(
    (SELECT count(DISTINCT "epochId") FROM "task_schedule_run" WHERE "scheduleId" = v1.id AND state = 'RELEASED') = 2
      AND NOT EXISTS (
        SELECT 1 FROM "task_schedule_run"
        WHERE "scheduleId" = v1.id AND state = 'RELEASED'
          AND ("epochId" = v1."epochId" OR "originalScheduledAt" <> "effectiveScheduledAt")
      ),
    'released v1 rows sit in their own epoch at their release time, the duplicate apart'
  );
  PERFORM pg_temp.expect(
    (SELECT "sourceType" = 'PROJECT' AND "sourceProjectId" = '22222222-2222-4222-8222-222222222222'
     FROM "task_schedule_run" WHERE id = 'a0000000-0000-4000-8000-000000000002'),
    'a row of unknown source takes the template''s project'
  );

  -- v2: released, skip, and move kept; stale planned rows gone or canceled.
  PERFORM pg_temp.expect(
    (SELECT state = 'RELEASED' AND "releasedTaskId" = 'v2-release' AND "scheduleId" = v2.id
     FROM "task_schedule_run" WHERE id = 'b0000000-0000-4000-8000-000000000001'),
    'v2 released Run keeps its Task'
  );
  PERFORM pg_temp.expect(
    (SELECT state = 'SKIPPED' AND "actorUserId" = 'person' AND "scheduleId" = v2.id
     FROM "task_schedule_run" WHERE id = 'b0000000-0000-4000-8000-000000000002'),
    'v2 skip is kept with its actor'
  );
  PERFORM pg_temp.expect(
    (SELECT state = 'PLANNED' AND "originalScheduledAt" = '2030-01-03 09:00' AND "effectiveScheduledAt" = '2030-01-02 09:00'
     FROM "task_schedule_run" WHERE id = 'b0000000-0000-4000-8000-000000000003'),
    'v2 move is kept'
  );
  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1 FROM "task_schedule_run"
      WHERE id IN ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000006')
    ),
    'ordinary planned rows before the next run or of an old epoch are removed'
  );
  PERFORM pg_temp.expect(
    (SELECT state = 'CANCELED' FROM "task_schedule_run" WHERE id = 'b0000000-0000-4000-8000-000000000007'),
    'an old epoch''s move is canceled into the history'
  );

  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task_schedule_run" WHERE "scheduleId" = quarantined.id) = 1
      AND (SELECT state = 'SKIPPED' FROM "task_schedule_run" WHERE id = 'd0000000-0000-4000-8000-000000000001'),
    'a Paused schedule keeps its skip and drops its ordinary planned Run'
  );

  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task_schedule_run" r JOIN "task_schedule" s ON s.id = r."scheduleId"
     WHERE s.name = 'Four times' AND r.state = 'PLANNED' AND r."effectiveScheduledAt" = '2030-03-01 09:00'
       AND r."originalScheduledAt" = '2030-03-01 09:00' AND r."epochId" = s."epochId") = 1,
    'an Active schedule without a planned next run gets one'
  );

  -- Nothing fires twice: every Active schedule's next run is after its last
  -- release, and no planned Run repeats a released rule time.
  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1
      FROM "task_schedule" s
      JOIN "task_schedule_run" released ON released."scheduleId" = s.id AND released.state = 'RELEASED'
      WHERE s.state = 'ACTIVE' AND s."nextRunAt" <= released."effectiveScheduledAt"
    ),
    'next run is after the last released one'
  );
  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1
      FROM "task_schedule_run" planned
      JOIN "task_schedule_run" released
        ON released."scheduleId" = planned."scheduleId"
       AND released.state = 'RELEASED'
       AND planned."effectiveScheduledAt" <= released."effectiveScheduledAt"
      WHERE planned.state = 'PLANNED'
    ),
    'no planned Run is due before a released one'
  );
  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1 FROM "task_schedule" s
      WHERE s.state = 'ACTIVE' AND s."nextRunAt" IS DISTINCT FROM (
        SELECT min("effectiveScheduledAt") FROM "task_schedule_run"
        WHERE "scheduleId" = s.id AND state = 'PLANNED'
      )
    ),
    'an Active schedule''s next run is its earliest planned Run'
  );
END;
$$;

-- Tasks ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task" t JOIN "task_schedule" s ON s.id = t."scheduleId" AND s.name = 'Weekly v1'
     WHERE t.id IN ('v1-release-a', 'v1-release-b', 'v1-release-dup')) = 3
      AND (SELECT "scheduleId" IS NOT NULL FROM "task" WHERE id = 'v2-release')
      AND (SELECT "scheduleId" IS NOT NULL FROM "task" WHERE id = 'v2-after-release'),
    'released Tasks carry their scheduleId'
  );
  PERFORM pg_temp.expect(
    (SELECT "scheduleId" IS NULL FROM "task" WHERE id = 'v2'),
    'a RELATES link does not set scheduleId'
  );
  PERFORM pg_temp.expect(
    (SELECT bool_and("archivedAt" IS NOT NULL AND "nextRunAt" IS NULL AND metadata IS NOT NULL AND "scheduleId" IS NULL)
     FROM "task" WHERE id IN ('v1', 'v2', 'v2-after', 'quarantined', 'person-ready')),
    'templates are archived and stop waking the old release'
  );
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "task_link" WHERE "fromTaskId" = 'v1') = 4,
    'template links stay'
  );

  PERFORM pg_temp.expect(
    (SELECT status = 'QUEUED' AND "runAt" = '2030-02-01 10:00' AND metadata IS NULL AND "nextRunAt" IS NULL AND "archivedAt" IS NULL
     FROM "task" WHERE id = 'once-v2'),
    'a v2 one-time schedule becomes the Run at of a Queued Task'
  );
  PERFORM pg_temp.expect(
    (SELECT status = 'QUEUED' AND "runAt" = '2030-02-02 08:30' AND metadata IS NULL FROM "task" WHERE id = 'once-v1'),
    'a v1 one-time schedule becomes the Run at'
  );
  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1 FROM "task_schedule_run"
      WHERE "seriesTaskId" IN ('once-v2', 'once-released') OR "releasedTaskId" = 'once-released'
    ),
    'one-time ledger rows are removed'
  );

  PERFORM pg_temp.expect(
    (SELECT "archivedAt" = '2026-09-10' AND metadata IS NOT NULL AND "nextRunAt" = '2030-01-01 09:00' FROM "task" WHERE id = 'archived')
      AND (SELECT "seriesTaskId" = 'archived' AND "scheduleId" IS NULL
           FROM "task_schedule_run" WHERE id = 'f0000000-0000-4000-8000-000000000001'),
    'an archived template is ignored'
  );
  PERFORM pg_temp.expect(
    (SELECT status = 'QUEUED' AND "runAt" IS NULL AND metadata IS NOT NULL AND "nextRunAt" = '2030-02-03 09:00'
     FROM "task" WHERE id = 'once-quarantined')
      AND (SELECT count(*) FROM "task_schedule_run" WHERE "seriesTaskId" = 'once-quarantined') = 2,
    'a quarantined one-time Task and its ledger rows stay for operator repair'
  );
  PERFORM pg_temp.expect(
    (SELECT metadata = '{"design":"md"}' FROM "task" WHERE id = 'not-a-schedule')
      AND (SELECT metadata = 'not json' FROM "task" WHERE id = 'malformed'),
    'metadata that is not a schedule is left alone'
  );
END;
$$;

-- Idempotency ----------------------------------------------------------------

CREATE TEMP TABLE first_pass AS
SELECT
  (SELECT md5(string_agg(s::TEXT, '|' ORDER BY s.id)) FROM (
     SELECT id, state, "epochId", "nextRunAt", "releasedCount", "targetRunCount", revision FROM "task_schedule"
   ) AS s) AS schedules,
  (SELECT md5(string_agg(r::TEXT, '|' ORDER BY r.id)) FROM (
     SELECT id, "scheduleId", "seriesTaskId", "epochId", state, "originalScheduledAt", "effectiveScheduledAt" FROM "task_schedule_run"
   ) AS r) AS runs,
  (SELECT md5(string_agg(t::TEXT, '|' ORDER BY t.id)) FROM (
     SELECT id, status, "archivedAt", "scheduleId", "runAt", metadata, "nextRunAt", "scheduleRevision" FROM "task"
   ) AS t) AS tasks;

\ir ../migrations/20260924120000_task_schedule_cutover/migration.sql

DO $$
DECLARE
  before first_pass%ROWTYPE;
BEGIN
  SELECT * INTO before FROM first_pass;
  PERFORM pg_temp.expect(
    before.schedules = (SELECT md5(string_agg(s::TEXT, '|' ORDER BY s.id)) FROM (
      SELECT id, state, "epochId", "nextRunAt", "releasedCount", "targetRunCount", revision FROM "task_schedule"
    ) AS s),
    'a second run leaves the schedules alone'
  );
  PERFORM pg_temp.expect(
    before.runs = (SELECT md5(string_agg(r::TEXT, '|' ORDER BY r.id)) FROM (
      SELECT id, "scheduleId", "seriesTaskId", "epochId", state, "originalScheduledAt", "effectiveScheduledAt" FROM "task_schedule_run"
    ) AS r),
    'a second run leaves the Runs alone'
  );
  PERFORM pg_temp.expect(
    before.tasks = (SELECT md5(string_agg(t::TEXT, '|' ORDER BY t.id)) FROM (
      SELECT id, status, "archivedAt", "scheduleId", "runAt", metadata, "nextRunAt", "scheduleRevision" FROM "task"
    ) AS t),
    'a second run leaves the Tasks alone'
  );
END;
$$;

\echo 'task-schedule-cutover: ok'
