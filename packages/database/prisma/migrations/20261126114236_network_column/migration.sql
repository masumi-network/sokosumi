-- Which Network the Job or Transaction a row points at is on. NULL: the row
-- points at none, or was written by a release that does not know the column.
--
-- Every statement can run again, so a deploy that fails in the middle can be
-- finished by the next one. NOT VALID: the previous Core release keeps writing
-- during the deploy, and checking every row here would hold the table's
-- exclusive lock for the scan. VALIDATE at the end lets reads and writes
-- through.
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

-- Every Job is on Mainnet today. No trigger fires on either update: "history"
-- has none, and the one on "notification" fires for "workspaceId" and "userId"
-- only. Task events are not tagged here: that update would fire
-- history_task_event_sync twice per row, and runs at the cutover instead.
UPDATE "history" SET "network" = 'mainnet' WHERE "kind" = 'JOB' AND "network" IS NULL;
UPDATE "notification" SET "network" = 'mainnet' WHERE "kind" = 'JOB' AND "network" IS NULL;

ALTER TABLE "history" VALIDATE CONSTRAINT "history_network_check";
ALTER TABLE "notification" VALIDATE CONSTRAINT "notification_network_check";
ALTER TABLE "taskEvent" VALIDATE CONSTRAINT "taskEvent_network_check";
