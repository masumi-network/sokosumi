-- Which Network the Job or Transaction a row points at is on. NULL: the row
-- points at none, or was written by a release that does not know the column.
--
-- NOT VALID: the previous Core release keeps writing during the deploy, and
-- checking every row here would hold the table's exclusive lock for the scan.
--
-- The three ALTER TABLE statements that add the column take ACCESS EXCLUSIVE.
-- While one waits behind an open transaction, every later read and write of
-- that table waits behind it, so it gives up after 5 seconds. The deploy then fails with 55P03 and the
-- statements before it stay applied. Every statement can run again: run
-- `prisma migrate resolve --rolled-back 20261126114236_network_column` on the
-- direct URL (DATABASE_URL_UNPOOLED), then deploy again. A plain redeploy
-- stops at P3009.
SET lock_timeout = '5s';
ALTER TABLE "history"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "history_network_check",
  ADD CONSTRAINT "history_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;
ALTER TABLE "notification"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "notification_network_check",
  ADD CONSTRAINT "notification_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;
ALTER TABLE "taskEvent"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "taskEvent_network_check",
  ADD CONSTRAINT "taskEvent_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;

-- RESET ends this migration's 5-second override and restores the role's
-- default. The updates wait on row locks: under the override a busy row would
-- fail the deploy. VALIDATE takes SHARE UPDATE EXCLUSIVE, which ordinary reads
-- and writes do not conflict with; it can wait on another schema change or on
-- maintenance of the table.
RESET lock_timeout;

-- Every Job is on Mainnet today. No trigger fires on either update: "history"
-- has none, and the one on "notification" fires for "workspaceId" and "userId"
-- only. Task events are not tagged here: that update would fire
-- history_task_event_sync twice per row, and runs at the cutover instead.
UPDATE "history" SET "network" = 'mainnet' WHERE "kind" = 'JOB' AND "network" IS NULL;
UPDATE "notification" SET "network" = 'mainnet' WHERE "kind" = 'JOB' AND "network" IS NULL;

ALTER TABLE "history" VALIDATE CONSTRAINT "history_network_check";
ALTER TABLE "notification" VALIDATE CONSTRAINT "notification_network_check";
ALTER TABLE "taskEvent" VALIDATE CONSTRAINT "taskEvent_network_check";
