-- Backfill schedule-created PARENT edges to SCHEDULE.
-- Parent: is/was a schedule template (QUEUED, schedule fields, or ever QUEUED).
-- Child: schedule-clone fingerprint —
--   * same name as template (cloneRecurringOccurrence copies name)
--   * born READY with no DRAFT history (user tasks typically pass DRAFT)
UPDATE "task_link" AS tl
SET "type" = 'SCHEDULE'
FROM "task" AS parent
INNER JOIN "task" AS child ON child."id" = tl."toTaskId"
WHERE tl."fromTaskId" = parent."id"
  AND tl."type" = 'PARENT'
  AND child."name" = parent."name"
  AND (
    parent."status" = 'QUEUED'
    OR parent."nextRunAt" IS NOT NULL
    OR (
      parent."metadata" IS NOT NULL
      AND parent."metadata"::jsonb ->> 'version' = '1'
      AND parent."metadata"::jsonb ->> 'mode' IN ('once', 'recurring')
    )
    OR EXISTS (
      SELECT 1
      FROM "taskEvent" AS te
      WHERE te."taskId" = parent."id"
        AND te."status" = 'QUEUED'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM "taskEvent" AS te
    WHERE te."taskId" = child."id"
      AND te."status" = 'READY'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "taskEvent" AS te
    WHERE te."taskId" = child."id"
      AND te."status" = 'DRAFT'
  );
