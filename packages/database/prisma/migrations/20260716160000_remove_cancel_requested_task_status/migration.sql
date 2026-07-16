-- Remove CANCEL_REQUESTED from TaskStatus (SOK-632).
-- SOK-582 already backfilled task.status → CANCELED; historical taskEvent rows
-- still used CANCEL_REQUESTED for the old intermediate cancel-request step.
--
-- Prefer deleting those intermediate events so timelines stay
-- … → CANCELED (not … → CANCELED → CANCELED). When a task has no CANCELED
-- event yet (status was force-updated on the task row only), keep one
-- CANCEL_REQUESTED event rewritten to CANCELED so cancel is still visible.
BEGIN;

-- Idempotent: any leftover CANCEL_REQUESTED tasks → CANCELED.
UPDATE "task"
SET "status" = 'CANCELED'
WHERE "status" = 'CANCEL_REQUESTED';

-- Keep one cancel signal when the task has no CANCELED event yet.
-- Pick the latest CANCEL_REQUESTED event per task so multiples do not
-- become duplicate CANCELED timeline rows.
UPDATE "taskEvent" AS te
SET "status" = 'CANCELED'
WHERE te."id" IN (
  SELECT DISTINCT ON ("taskId") "id"
  FROM "taskEvent"
  WHERE "status" = 'CANCEL_REQUESTED'
    AND NOT EXISTS (
      SELECT 1
      FROM "taskEvent" AS other
      WHERE other."taskId" = "taskEvent"."taskId"
        AND other."status" = 'CANCELED'
    )
  ORDER BY "taskId", "createdAt" DESC, "id" DESC
);

-- Drop remaining intermediate cancel-request events from history.
DELETE FROM "taskEvent"
WHERE "status" = 'CANCEL_REQUESTED';

CREATE TYPE "TaskStatus_new" AS ENUM (
  'DRAFT',
  'QUEUED',
  'READY',
  'GRANT_PENDING',
  'INPUT_REQUIRED',
  'APPROVAL_REQUIRED',
  'AUTHENTICATION_REQUIRED',
  'OUT_OF_CREDITS',
  'CREDITS_TOPPED_UP',
  'RUNNING',
  'AWAITING_EXTERNAL',
  'COMPLETED',
  'FAILED',
  'CANCELED'
);
ALTER TABLE "task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "task" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TABLE "taskEvent" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
DROP TYPE "public"."TaskStatus_old";
ALTER TABLE "task" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

COMMIT;
