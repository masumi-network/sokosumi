-- The previous Core release can still insert NULL during rollout.
-- NOT VALID avoids scanning under ACCESS EXCLUSIVE. The 5s timeout caps how
-- long each exclusive lock request can queue later reads and writes.
-- After a failed deploy, run prisma migrate resolve --rolled-back
-- 20261126200926_soko_bot_network on the direct URL, then deploy again.
SET lock_timeout = '5s';
ALTER TABLE "soko_bot_turn"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "soko_bot_turn_network_check",
  ADD CONSTRAINT "soko_bot_turn_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;
ALTER TABLE "soko_bot_delegation"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "soko_bot_delegation_network_check",
  ADD CONSTRAINT "soko_bot_delegation_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;
ALTER TABLE "soko_bot_schedule"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "soko_bot_schedule_network_check",
  ADD CONSTRAINT "soko_bot_schedule_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;
-- Keep the timeout during this backfill because a wait on one turn would
-- otherwise hold locks on the turns already rewritten and stall their heartbeats.
-- A blocked statement fails with 55P03 and releases its row locks.
-- Leave "updatedAt" untouched because schedule retention depends on it.
UPDATE "soko_bot_turn" SET "network" = 'mainnet' WHERE "network" IS NULL;
UPDATE "soko_bot_delegation" SET "network" = 'mainnet' WHERE "network" IS NULL AND "jobId" IS NOT NULL;
UPDATE "soko_bot_schedule" SET "network" = 'mainnet' WHERE "network" IS NULL AND "jobId" IS NOT NULL;
RESET lock_timeout;

ALTER TABLE "soko_bot_turn" VALIDATE CONSTRAINT "soko_bot_turn_network_check";
ALTER TABLE "soko_bot_delegation" VALIDATE CONSTRAINT "soko_bot_delegation_network_check";
ALTER TABLE "soko_bot_schedule" VALIDATE CONSTRAINT "soko_bot_schedule_network_check";
