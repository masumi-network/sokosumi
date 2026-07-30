-- Backfill schedule-created PARENT edges to SCHEDULE.
-- Heuristic: template was ever QUEUED, still has schedule fields, or is QUEUED.
UPDATE "task_link" AS tl
SET "type" = 'SCHEDULE'
FROM "task" AS t
WHERE tl."fromTaskId" = t."id"
  AND tl."type" = 'PARENT'
  AND (
    t."status" = 'QUEUED'
    OR t."nextRunAt" IS NOT NULL
    OR (
      t."metadata" IS NOT NULL
      AND t."metadata"::jsonb ->> 'version' = '1'
      AND t."metadata"::jsonb ->> 'mode' IN ('once', 'recurring')
    )
    OR EXISTS (
      SELECT 1
      FROM "taskEvent" AS te
      WHERE te."taskId" = t."id"
        AND te."status" = 'QUEUED'
    )
  );
