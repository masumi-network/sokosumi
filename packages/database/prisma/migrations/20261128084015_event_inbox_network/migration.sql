-- Nullable with no default: old Job rows and inserts from the previous Core
-- release mean Mainnet. Shared Task events carry no Network. No backfill.
-- Adding the column and NOT VALID check takes a brief ACCESS EXCLUSIVE
-- lock without rewriting or scanning the table. Give up after 5s rather
-- than queuing readers and writers behind a waiting exclusive lock.
-- After 55P03 use prisma migrate resolve --rolled-back 20261128084015_event_inbox_network
-- on DATABASE_URL_UNPOOLED, then deploy again. A plain retry stops at P3009.
SET lock_timeout = '5s';
ALTER TABLE "soko_bot_event_inbox"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  DROP CONSTRAINT IF EXISTS "soko_bot_event_inbox_network_check",
  ADD CONSTRAINT "soko_bot_event_inbox_network_check"
    CHECK ("network" IS NULL OR ("purpose" = 'JOB_EVENT' AND "network" IN ('mainnet', 'preprod'))) NOT VALID;
RESET lock_timeout;
ALTER TABLE "soko_bot_event_inbox" VALIDATE CONSTRAINT "soko_bot_event_inbox_network_check";
