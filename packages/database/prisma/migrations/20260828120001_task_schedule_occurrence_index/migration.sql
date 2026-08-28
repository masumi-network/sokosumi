ALTER TABLE "task_schedule_occurrence"
  ADD COLUMN "scheduleVersion" INTEGER NOT NULL DEFAULT 2;

UPDATE "task_schedule_occurrence"
SET "scheduleVersion" = CASE
  WHEN "legacyLinkId" IS NULL THEN 2
  ELSE 1
END;

ALTER TABLE "task_schedule_occurrence"
  DROP CONSTRAINT "task_schedule_occurrence_identity_branch_check",
  ADD CONSTRAINT "task_schedule_occurrence_identity_branch_check" CHECK (
    (
      "scheduleVersion" = 2
      AND "legacyLinkId" IS NULL
      AND "epochId" IS NOT NULL
      AND "originalScheduledAt" IS NOT NULL
      AND "timezone" IS NOT NULL
      AND "sourceType" IN ('WORKSPACE', 'PROJECT')
      AND "sourceAccuracy" = 'EXACT'
      AND "timeAccuracy" = 'EXACT'
    )
    OR (
      "scheduleVersion" = 1
      AND "legacyLinkId" IS NULL
      AND "epochId" IS NULL
      AND "originalScheduledAt" IS NOT NULL
      AND "state" = 'PLANNED'
      AND "sourceType" IN ('WORKSPACE', 'PROJECT')
      AND "sourceAccuracy" = 'EXACT'
      AND "timeAccuracy" = 'EXACT'
      AND "ruleSnapshot" IS NOT NULL
    )
    OR (
      "legacyLinkId" IS NOT NULL
      AND "timeAccuracy" = 'APPROXIMATE'
      AND (
        ("sourceAccuracy" = 'INFERRED' AND "sourceType" IN ('WORKSPACE', 'PROJECT'))
        OR ("sourceAccuracy" = 'UNKNOWN' AND "sourceType" = 'LEGACY_UNKNOWN')
      )
    )
  );

CREATE UNIQUE INDEX "task_schedule_occurrence_v1_planned_original_key"
  ON "task_schedule_occurrence"("seriesTaskId", "originalScheduledAt")
  WHERE "scheduleVersion" = 1
    AND "legacyLinkId" IS NULL;
