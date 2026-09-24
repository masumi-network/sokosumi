-- ADR 0041 cutover (SOK-1172): every live series moves into task_schedule,
-- and the ledger takes the Run name. The old columns (Task.metadata,
-- Task.nextRunAt, seriesTaskId, legacyLinkId, the SCHEDULE link type) stay
-- until SOK-1174 drops them.
--
-- Not backward-compatible with the previous Core release: it renames the
-- ledger that release reads and archives the templates its release scans.
-- Deployment must drain old Core writes (the /sync/task-schedules cron above
-- all) before this migration starts. ADR 0041 accepts the single deploy;
-- rollback is the pre-migration snapshot.
--
-- Re-running this file is safe: the rename checks what exists, schedule and
-- epoch ids derive from the template Task id, and every step only picks up
-- rows an earlier run left unmigrated. prisma/tests/task-schedule-cutover.sql
-- runs it twice against fixtures.
--
-- Task.metadata holds only schedule JSON: every Core write to it is a
-- schedule write. Values that are not schedule-shaped are left untouched and
-- counted in the closing notice for SOK-1174.

BEGIN;

-- 1. The ledger takes the Run name, with its constraints, indexes, enum,
-- and trigger. The trigger payload keeps its "occurrence_changed" kind, so
-- the Calendar outbox consumer is unaffected.
DO $$
DECLARE
  item RECORD;
BEGIN
  IF to_regclass('"task_schedule_occurrence"') IS NOT NULL THEN
    ALTER TABLE "task_schedule_occurrence" RENAME TO "task_schedule_run";
  END IF;

  -- Named on its own so partial-unique-schema-coverage.test.ts, which reads
  -- migration text, sees the partial unique's new name.
  ALTER INDEX IF EXISTS "task_schedule_occurrence_v1_planned_original_key" RENAME TO "task_schedule_run_v1_planned_original_key";

  FOR item IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '"task_schedule_run"'::regclass
      AND conname LIKE 'task\_schedule\_occurrence\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE "task_schedule_run" RENAME CONSTRAINT %I TO %I',
      item.conname,
      replace(item.conname, 'task_schedule_occurrence_', 'task_schedule_run_')
    );
  END LOOP;

  -- Indexes that back no constraint (the constraint rename moved the rest).
  FOR item IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'task_schedule_run'
      AND indexname LIKE 'task\_schedule\_occurrence\_%'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      item.indexname,
      replace(item.indexname, 'task_schedule_occurrence_', 'task_schedule_run_')
    );
  END LOOP;

  IF to_regtype('"TaskScheduleOccurrenceState"') IS NOT NULL THEN
    ALTER TYPE "TaskScheduleOccurrenceState" RENAME TO "TaskScheduleRunState";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = '"task_schedule_run"'::regclass
      AND tgname = 'calendar_occurrence_invalidation'
  ) THEN
    ALTER TRIGGER calendar_occurrence_invalidation ON "task_schedule_run"
      RENAME TO calendar_run_invalidation;
  END IF;

  IF to_regprocedure('invalidate_calendar_for_occurrence_change()') IS NOT NULL THEN
    ALTER FUNCTION invalidate_calendar_for_occurrence_change()
      RENAME TO invalidate_calendar_for_run_change;
  END IF;
END;
$$;

-- These two name the ledger table in their bodies. Same functions as before
-- (20260923200000 and 20260826150000), with the new table name.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_task_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
    calendar_relevant := NEW.metadata IS NOT NULL OR NEW."nextRunAt" IS NOT NULL
      OR NEW."runAt" IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    task_id := OLD.id;
    old_workspace_id := OLD."workspaceId";
    old_project_id := OLD."projectId";
    calendar_relevant := OLD.metadata IS NOT NULL OR OLD."nextRunAt" IS NOT NULL
      OR OLD."runAt" IS NOT NULL;
  ELSE
    task_id := NEW.id;
    old_workspace_id := OLD."workspaceId";
    new_workspace_id := NEW."workspaceId";
    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    IF ROW(
      OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.name,
      OLD.status, OLD."assigneeId", OLD."assigneeUserId", OLD."assigneeSokoBotId",
      OLD."scheduleRevision", OLD."nextRunAt", OLD.metadata, OLD."archivedAt",
      OLD."runAt"
    ) IS NOT DISTINCT FROM ROW(
      NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.name,
      NEW.status, NEW."assigneeId", NEW."assigneeUserId", NEW."assigneeSokoBotId",
      NEW."scheduleRevision", NEW."nextRunAt", NEW.metadata, NEW."archivedAt",
      NEW."runAt"
    ) THEN
      RETURN NEW;
    END IF;
    calendar_relevant :=
      OLD.metadata IS NOT NULL OR OLD."nextRunAt" IS NOT NULL
      OR NEW.metadata IS NOT NULL OR NEW."nextRunAt" IS NOT NULL
      OR OLD."runAt" IS NOT NULL OR NEW."runAt" IS NOT NULL;
  END IF;

  IF NOT calendar_relevant THEN
    SELECT EXISTS (
      SELECT 1
      FROM "task_schedule_run"
      WHERE "seriesTaskId" = task_id OR "releasedTaskId" = task_id
    ) INTO calendar_relevant;
  END IF;

  IF calendar_relevant AND old_workspace_id IS DISTINCT FROM new_workspace_id THEN
    IF old_workspace_id IS NOT NULL THEN
      PERFORM enqueue_calendar_invalidation(
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
      PERFORM enqueue_calendar_invalidation(
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
    PERFORM enqueue_calendar_invalidation(
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
$$;

CREATE OR REPLACE FUNCTION prevent_project_delete_with_calendar_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "task" AS t
    JOIN "user" AS owner ON owner.id = t."ownerId"
    WHERE t."projectId" = OLD.id
      AND t."archivedAt" IS NULL
      AND lower(owner.email) ~ '^[^@]+@nmkr\.io$'
      AND (
        t."nextRunAt" IS NOT NULL
        OR t.metadata IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task" AS t
    JOIN "task_schedule_quarantine" AS quarantine
      ON quarantine."taskId" = t.id
    JOIN "user" AS owner ON owner.id = t."ownerId"
    WHERE t."projectId" = OLD.id
      AND lower(owner.email) ~ '^[^@]+@nmkr\.io$'
  ) OR EXISTS (
    SELECT 1
    FROM "task_link" AS link
    JOIN "task" AS source_task ON source_task.id = link."fromTaskId"
    JOIN "task" AS target_task ON target_task.id = link."toTaskId"
    JOIN "user" AS owner ON owner.id = source_task."ownerId"
    WHERE link.type = 'SCHEDULE'
      AND lower(owner.email) ~ '^[^@]+@nmkr\.io$'
      AND (
        source_task."projectId" = OLD.id
        OR target_task."projectId" = OLD.id
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task_schedule_run" AS occurrence
    WHERE occurrence."sourceProjectId" = OLD.id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN OLD;
END;
$$;

-- Rule JSON times are ISO strings; the columns hold UTC.
SET LOCAL TIME ZONE 'UTC';

-- Malformed values (a quarantined rule, say) read as NULL instead of failing
-- the migration.
CREATE OR REPLACE FUNCTION pg_temp.cutover_jsonb(value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF value IS NULL OR value = '' THEN
    RETURN NULL;
  END IF;
  RETURN value::JSONB;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.cutover_timestamp(value TEXT)
RETURNS TIMESTAMP(3)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (value::TIMESTAMPTZ AT TIME ZONE 'UTC')::TIMESTAMP(3);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.cutover_uuid(value TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN value::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- A JSON integer of at least `minimum`, or NULL.
CREATE OR REPLACE FUNCTION pg_temp.cutover_integer(value JSONB, minimum INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed INTEGER;
BEGIN
  IF jsonb_typeof(value) <> 'number' OR value::NUMERIC <> trunc(value::NUMERIC) THEN
    RETURN NULL;
  END IF;
  parsed := value::NUMERIC::INTEGER;
  RETURN CASE WHEN parsed >= minimum THEN parsed END;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Ids this migration mints derive from what they belong to, so a second run
-- finds the rows the first one wrote.
CREATE OR REPLACE FUNCTION pg_temp.cutover_id(kind TEXT, source_id TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5('task-schedule-cutover:' || kind || ':' || source_id)::UUID
$$;

-- 2. The series to move: every non-archived Task whose metadata is a v1 or
-- v2 recurring rule. An archived template is left as it is.
CREATE TEMP TABLE cutover_series ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    t.id,
    t.status,
    t."projectId" AS project_id,
    btrim(rule->>'expr') AS expr,
    t."nextRunAt",
    t."createdAt",
    rule,
    (rule->>'version')::INTEGER AS version,
    EXISTS (
      SELECT 1 FROM "task_schedule_quarantine" AS quarantine
      WHERE quarantine."taskId" = t.id
    ) AS quarantined,
    (
      SELECT count(*)::INTEGER
      FROM "task_link" AS link
      WHERE link."fromTaskId" = t.id AND link.type = 'SCHEDULE'
    ) AS released_links
  FROM "task" AS t
  CROSS JOIN LATERAL pg_temp.cutover_jsonb(t.metadata) AS rule
  WHERE t."archivedAt" IS NULL
    AND t.metadata IS NOT NULL
    AND rule->>'mode' = 'recurring'
    AND rule->>'version' IN ('1', '2')
    AND NULLIF(btrim(rule->>'expr'), '') IS NOT NULL
),
parsed AS (
  SELECT
    c.*,
    COALESCE(rule->>'endsMode', 'never') AS ends_mode_raw,
    pg_temp.cutover_timestamp(rule->>'endsOn') AS ends_on_raw,
    pg_temp.cutover_integer(
      CASE WHEN version = 1 THEN rule->'occurrences' ELSE rule->'targetReleaseCount' END,
      1
    ) AS count_raw
  FROM candidates AS c
),
ruled AS (
  SELECT
    p.*,
    CASE
      WHEN ends_mode_raw = 'on' AND ends_on_raw IS NOT NULL THEN 'ON'
      WHEN ends_mode_raw = 'after' AND count_raw IS NOT NULL THEN 'AFTER'
      ELSE 'NEVER'
    END AS ends_mode,
    -- A rule whose end is missing its date or count runs as "never" but
    -- stays Paused until someone looks at it.
    NOT (
      ends_mode_raw = 'never'
      OR (ends_mode_raw = 'on' AND ends_on_raw IS NOT NULL)
      OR (ends_mode_raw = 'after' AND count_raw IS NOT NULL)
    ) AS end_rule_repaired
  FROM parsed AS p
)
SELECT
  r.id AS task_id,
  pg_temp.cutover_id('schedule', r.id) AS schedule_id,
  r.version,
  CASE
    WHEN r.status = 'QUEUED'
      AND NOT r.quarantined
      AND r."nextRunAt" IS NOT NULL
      AND NOT r.end_rule_repaired
    THEN 'ACTIVE'
    -- Quarantined, never released (a person-assigned series left in Ready),
    -- or not releasable as it stands.
    ELSE 'PAUSED'
  END::"TaskScheduleState" AS state,
  r.expr,
  COALESCE(NULLIF(r.rule->>'timezone', ''), 'UTC') AS timezone,
  -- As the old release read it: `intervalDays` above 1, else a legacy
  -- "M H */N * *" cron means every N days from the anchor.
  COALESCE(
    pg_temp.cutover_integer(r.rule->'intervalDays', 2),
    pg_temp.cutover_integer(
      NULLIF(ltrim((regexp_match(r.expr, '^(\d+) (\d+) \*/(\d+) \* \*$'))[3], '0'), '')::JSONB,
      2
    ),
    pg_temp.cutover_integer(r.rule->'intervalDays', 1)
  ) AS interval_days,
  r.project_id,
  COALESCE(
    pg_temp.cutover_timestamp(r.rule->>'anchorAt'),
    pg_temp.cutover_timestamp(r.rule->>'scheduledAt'),
    pg_temp.cutover_timestamp(r.rule->>'createdAt'),
    r."createdAt"
  ) AS anchor_at,
  COALESCE(
    pg_temp.cutover_timestamp(r.rule->>'ruleEffectiveFrom'),
    pg_temp.cutover_timestamp(r.rule->>'scheduledAt'),
    r."createdAt"
  ) AS rule_effective_from,
  -- v1 has no epoch; its planned Runs join a new one.
  COALESCE(
    CASE WHEN r.version = 2 THEN pg_temp.cutover_uuid(r.rule->>'epochId') END,
    pg_temp.cutover_id('epoch', r.id)
  ) AS epoch_id,
  -- Released v1 Runs never had an epoch or an exact rule time.
  pg_temp.cutover_id('legacy-epoch', r.id) AS legacy_epoch_id,
  r.ends_mode::"TaskScheduleEndsMode" AS ends_mode,
  CASE WHEN r.ends_mode = 'ON' THEN r.ends_on_raw END AS ends_on,
  -- v1 counts the Runs left down; the links are the ones already released.
  -- v2 counts the current epoch's releases against its target.
  CASE
    WHEN r.ends_mode <> 'AFTER' THEN NULL
    WHEN r.version = 1 THEN r.count_raw + r.released_links
    ELSE r.count_raw
  END AS target_run_count,
  CASE
    WHEN r.version = 1 THEN r.released_links
    ELSE COALESCE(pg_temp.cutover_integer(r.rule->'epochReleaseCount', 0), 0)
  END AS released_count,
  CASE
    WHEN r.status = 'QUEUED'
      AND NOT r.quarantined
      AND NOT r.end_rule_repaired
    THEN r."nextRunAt"
  END AS next_run_at
FROM ruled AS r;

-- 3. Each series becomes a Task Schedule with the template as its
-- blueprint.
INSERT INTO "task_schedule" (
  "id", "createdAt", "updatedAt", "workspaceId", "organizationId", "ownerId",
  "creatorUserId", "creatorCoworkerId", "creatorSokoBotId", "state",
  "expr", "timezone", "intervalDays", "anchorAt", "ruleEffectiveFrom",
  "epochId", "endsMode", "endsOn", "targetRunCount", "releasedCount",
  "nextRunAt", "name", "description", "projectId", "visibility",
  "assigneeId", "assigneeSokoBotId", "assigneeUserId"
)
SELECT
  s.schedule_id, t."createdAt", CURRENT_TIMESTAMP, t."workspaceId",
  t."organizationId", t."ownerId", t."creatorUserId", t."creatorCoworkerId",
  t."creatorSokoBotId", s.state, s.expr, s.timezone, s.interval_days,
  s.anchor_at, s.rule_effective_from, s.epoch_id, s.ends_mode, s.ends_on,
  s.target_run_count, s.released_count, s.next_run_at, t.name,
  t.description, t."projectId", t.visibility, t."assigneeId",
  t."assigneeSokoBotId", t."assigneeUserId"
FROM cutover_series AS s
JOIN "task" AS t ON t.id = s.task_id
ON CONFLICT ("id") DO NOTHING;

-- 4. Planned Runs the new release must not pick up: another epoch's (the
-- old release never released them), ones before the next run (already
-- passed over), and a Paused schedule's ordinary ones (pause keeps only
-- skips and moves). A moved one is canceled into the history, as a rule
-- edit does; an ordinary one goes.
CREATE TEMP TABLE cutover_stale_runs ON COMMIT DROP AS
SELECT
  run.id,
  run."originalScheduledAt" IS DISTINCT FROM run."effectiveScheduledAt"
    AND run."originalScheduledAt" IS NOT NULL AS moved
FROM "task_schedule_run" AS run
JOIN cutover_series AS s ON s.task_id = run."seriesTaskId"
WHERE run.state = 'PLANNED'
  AND NOT (
    COALESCE(
      run."epochId",
      CASE WHEN run."scheduleVersion" = 1 AND s.version = 1 THEN s.epoch_id END
    ) IS NOT DISTINCT FROM s.epoch_id
    AND CASE
      WHEN s.state = 'ACTIVE' THEN run."effectiveScheduledAt" >= s.next_run_at
      ELSE run."originalScheduledAt" IS DISTINCT FROM run."effectiveScheduledAt"
    END
  );

DELETE FROM "task_schedule_run" AS run
USING cutover_stale_runs AS stale
WHERE run.id = stale.id AND NOT stale.moved;

UPDATE "task_schedule_run" AS run
SET "state" = 'CANCELED', "updatedAt" = CURRENT_TIMESTAMP
FROM cutover_stale_runs AS stale
WHERE run.id = stale.id AND stale.moved;

-- 5. The remaining Runs move to the schedule, skips, moves, and released
-- links included, in the shape Task Schedule Runs use: an epoch, an exact
-- rule time, and a timezone. Released v1 rows only knew their release time,
-- which becomes their rule time; they share one epoch of their own, and a
-- second release at the same time gets its own. v1 planned rows cannot
-- collide in the schedule's epoch: task_schedule_run_v1_planned_original_key
-- already kept them unique per series and rule time. A row of unknown source
-- takes the template's project, as a Run planned now would.
UPDATE "task_schedule_run" AS run
SET
  "scheduleId" = src.schedule_id,
  "seriesTaskId" = NULL,
  "scheduleVersion" = 2,
  "epochId" = CASE
    WHEN run."legacyLinkId" IS NULL THEN COALESCE(run."epochId", src.epoch_id)
    WHEN src.same_time_rank = 1 THEN src.legacy_epoch_id
    ELSE pg_temp.cutover_id('legacy-run', run.id::TEXT)
  END,
  "originalScheduledAt" = COALESCE(run."originalScheduledAt", run."effectiveScheduledAt"),
  "legacyLinkId" = NULL,
  "timezone" = COALESCE(run.timezone, src.timezone),
  "sourceType" = CASE
    WHEN run."sourceType" <> 'LEGACY_UNKNOWN' THEN run."sourceType"
    WHEN src.project_id IS NULL THEN 'WORKSPACE'
    ELSE 'PROJECT'
  END::"CalendarSourceType",
  "sourceProjectId" = CASE
    WHEN run."sourceType" = 'LEGACY_UNKNOWN' THEN src.project_id
    ELSE run."sourceProjectId"
  END,
  "sourceAccuracy" = 'EXACT',
  "timeAccuracy" = 'EXACT',
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT
    candidate.id,
    s.schedule_id,
    s.epoch_id,
    s.legacy_epoch_id,
    s.timezone,
    s.project_id,
    row_number() OVER (
      PARTITION BY
        candidate."seriesTaskId",
        candidate."legacyLinkId" IS NOT NULL,
        COALESCE(candidate."originalScheduledAt", candidate."effectiveScheduledAt")
      ORDER BY candidate."createdAt", candidate.id
    ) AS same_time_rank
  FROM "task_schedule_run" AS candidate
  JOIN cutover_series AS s ON s.task_id = candidate."seriesTaskId"
) AS src
WHERE run.id = src.id;

-- 6. An Active schedule plans its next run, which the old release had not
-- reached yet (or a v1 rule never wrote down). The next release projects the
-- rest from there, so nothing released before fires again. A skipped or
-- canceled Run already holding that rule time stays as it is; the release
-- then finds nothing due and plans from now. Any other clash fails the
-- migration.
INSERT INTO "task_schedule_run" (
  "id", "updatedAt", "scheduleId", "epochId", "originalScheduledAt",
  "effectiveScheduledAt", "state", "scheduleVersion", "sourceWorkspaceId",
  "sourceType", "sourceProjectId", "timezone"
)
SELECT
  pg_temp.cutover_id('next-run', s.task_id),
  CURRENT_TIMESTAMP,
  s.schedule_id,
  s.epoch_id,
  s.next_run_at,
  s.next_run_at,
  'PLANNED',
  2,
  t."workspaceId",
  CASE WHEN t."projectId" IS NULL THEN 'WORKSPACE' ELSE 'PROJECT' END::"CalendarSourceType",
  t."projectId",
  s.timezone
FROM cutover_series AS s
JOIN "task" AS t ON t.id = s.task_id
WHERE s.state = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "task_schedule_run" AS run
    WHERE run."scheduleId" = s.schedule_id
      AND (
        (run.state = 'PLANNED' AND run."effectiveScheduledAt" = s.next_run_at)
        OR (run."epochId" = s.epoch_id AND run."originalScheduledAt" = s.next_run_at)
      )
  );

-- 7. Tasks a series released point at its schedule: by SCHEDULE link, and by
-- released Run for any whose link is gone.
UPDATE "task" AS t
SET "scheduleId" = s.schedule_id
FROM "task_link" AS link
JOIN cutover_series AS s ON s.task_id = link."fromTaskId"
WHERE link.type = 'SCHEDULE'
  AND link."toTaskId" = t.id
  AND t."scheduleId" IS NULL;

UPDATE "task" AS t
SET "scheduleId" = run."scheduleId"
FROM "task_schedule_run" AS run
JOIN cutover_series AS s ON s.schedule_id = run."scheduleId"
WHERE run."releasedTaskId" = t.id
  AND t.id <> s.task_id
  AND t."scheduleId" IS NULL;

-- 8. The template stops being work: archived with its events, comments, and
-- files. Its rule stays in metadata until SOK-1174 drops the column.
UPDATE "task" AS t
SET
  "archivedAt" = CURRENT_TIMESTAMP,
  "nextRunAt" = NULL,
  "scheduleRevision" = t."scheduleRevision" + 1
FROM cutover_series AS s
WHERE t.id = s.task_id
  AND t."archivedAt" IS NULL;

-- 9. A one-time schedule becomes the Task's Run at. It stays Queued; one in
-- any other status never released under the old rule and gets no Run at.
-- Its own ledger row (planned, or released onto itself) goes. A quarantined
-- one stays as it is for operator repair.
CREATE TEMP TABLE cutover_one_time ON COMMIT DROP AS
SELECT
  t.id AS task_id,
  t.status,
  COALESCE(
    CASE
      WHEN rule->>'version' = '2' THEN pg_temp.cutover_timestamp(rule->>'effectiveRunAt')
      ELSE pg_temp.cutover_timestamp(rule->>'runAt')
    END,
    t."nextRunAt"
  ) AS run_at
FROM "task" AS t
CROSS JOIN LATERAL pg_temp.cutover_jsonb(t.metadata) AS rule
WHERE t."archivedAt" IS NULL
  AND t.metadata IS NOT NULL
  AND rule->>'mode' = 'once'
  AND rule->>'version' IN ('1', '2')
  AND NOT EXISTS (
    SELECT 1 FROM "task_schedule_quarantine" AS quarantine
    WHERE quarantine."taskId" = t.id
  );

DELETE FROM cutover_one_time WHERE run_at IS NULL;

DELETE FROM "task_schedule_run" AS run
USING cutover_one_time AS one_time
WHERE run."seriesTaskId" = one_time.task_id;

-- A one-time schedule that already released left its row released onto the
-- same Task.
DELETE FROM "task_schedule_run" AS run
WHERE run."seriesTaskId" = run."releasedTaskId"
  AND NOT EXISTS (
    SELECT 1 FROM "task_schedule_quarantine" AS quarantine
    WHERE quarantine."taskId" = run."seriesTaskId"
  );

UPDATE "task" AS t
SET
  "runAt" = CASE WHEN one_time.status = 'QUEUED' THEN one_time.run_at END,
  "metadata" = NULL,
  "nextRunAt" = NULL,
  "scheduleRevision" = t."scheduleRevision" + 1
FROM cutover_one_time AS one_time
WHERE t.id = one_time.task_id;

-- 10. What stayed behind needs an operator before SOK-1174 drops the old
-- columns.
DO $$
DECLARE
  leftover_count INTEGER;
  leftover_ids TEXT;
BEGIN
  SELECT count(*), string_agg(id, ', ' ORDER BY id) FILTER (WHERE rn <= 20)
  INTO leftover_count, leftover_ids
  FROM (
    SELECT t.id, row_number() OVER (ORDER BY t.id) AS rn
    FROM "task" AS t
    CROSS JOIN LATERAL pg_temp.cutover_jsonb(t.metadata) AS rule
    WHERE t."archivedAt" IS NULL
      AND rule->>'version' IN ('1', '2')
      AND rule->>'mode' IN ('once', 'recurring')
  ) AS leftover;

  IF leftover_count > 0 THEN
    RAISE WARNING 'Task Schedule cutover left % Task(s) with a schedule it could not move (quarantined one-time, or no rule): %',
      leftover_count, leftover_ids;
  END IF;

  RAISE NOTICE 'Task Schedule cutover: % one-time schedule(s) outside Queued cleared without a Run at; % Task(s) keep metadata that is not a schedule',
    (SELECT count(*) FROM cutover_one_time WHERE status <> 'QUEUED'),
    (
      SELECT count(*)
      FROM "task" AS t
      CROSS JOIN LATERAL pg_temp.cutover_jsonb(t.metadata) AS rule
      WHERE t.metadata IS NOT NULL
        AND NOT (
          COALESCE(rule->>'version' IN ('1', '2'), false)
          AND COALESCE(rule->>'mode' IN ('once', 'recurring'), false)
        )
    );
END;
$$;

-- 11. A Task Schedule's Runs are all in that shape from now on; the
-- identity check covers the rest of it.
ALTER TABLE "task_schedule_run"
  DROP CONSTRAINT IF EXISTS "task_schedule_run_schedule_shape_check";
ALTER TABLE "task_schedule_run"
  ADD CONSTRAINT "task_schedule_run_schedule_shape_check" CHECK (
    "scheduleId" IS NULL OR ("scheduleVersion" = 2 AND "legacyLinkId" IS NULL)
  );

COMMIT;
