-- Catch up rows written or reserved before Core started stamping the Network.
-- After a failed deploy, run prisma migrate resolve --rolled-back
-- 20261127090602_soko_bot_network_catch_up on the direct URL, then deploy again.
SET lock_timeout = '5s';

-- Ticket 08 updated 10,778 turns in 0.5–0.9 s with a worst observed heartbeat
-- wait of 134 ms. This pass rewrites far fewer turns, so keep one UPDATE.
-- Keep the timeout so a blocked statement releases the locks it already holds.
-- Leave "updatedAt" untouched because schedule retention depends on it.
UPDATE "soko_bot_turn" SET "network" = 'mainnet' WHERE "network" IS NULL;
UPDATE "soko_bot_delegation" SET "network" = 'mainnet' WHERE "network" IS NULL AND "jobId" IS NOT NULL;
UPDATE "soko_bot_schedule" SET "network" = 'mainnet' WHERE "network" IS NULL AND "jobId" IS NOT NULL;

RESET lock_timeout;
