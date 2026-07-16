-- Backfill legacy cancel-request rows, then drop CANCEL_REQUESTED from TaskStatus.
-- Idempotent with 20260716150000 for task rows; also rewrites taskEvent.
BEGIN;

UPDATE "task"
SET "status" = 'CANCELED'
WHERE "status" = 'CANCEL_REQUESTED';

UPDATE "taskEvent"
SET "status" = 'CANCELED'
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
