-- The Preprod generation a row started under, and the Network of a chat
-- mention. Schema only: no default and no backfill, so every existing row and
-- every Mainnet row stays NULL. Core writes "preprodGeneration" only on a
-- Preprod row; the previous Core release keeps inserting without either column.
--
-- Each ALTER TABLE takes ACCESS EXCLUSIVE for a catalog change only: a
-- nullable column without a default rewrites no row, and NOT VALID scans none.
-- While one waits behind an open transaction, every later read and write of
-- that table waits behind it, so it gives up after 5 seconds. The deploy then
-- fails with 55P03 and the statements before it stay applied. Every statement
-- can run again: run
-- `prisma migrate resolve --rolled-back 20261127115610_preprod_generation` on
-- the direct URL (DATABASE_URL_UNPOOLED), then deploy again. A plain redeploy
-- stops at P3009.
SET lock_timeout = '5s';
ALTER TABLE "soko_bot_turn"
  ADD COLUMN IF NOT EXISTS "preprodGeneration" INTEGER;
ALTER TABLE "soko_bot_delegation"
  ADD COLUMN IF NOT EXISTS "preprodGeneration" INTEGER;
ALTER TABLE "soko_bot_schedule"
  ADD COLUMN IF NOT EXISTS "preprodGeneration" INTEGER;
ALTER TABLE "chat_room_mention"
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  ADD COLUMN IF NOT EXISTS "preprodGeneration" INTEGER,
  DROP CONSTRAINT IF EXISTS "chat_room_mention_network_check",
  ADD CONSTRAINT "chat_room_mention_network_check" CHECK ("network" IN ('mainnet', 'preprod')) NOT VALID;

-- RESET ends this migration's 5-second override. VALIDATE takes SHARE UPDATE
-- EXCLUSIVE, which ordinary reads and writes do not conflict with; every row
-- is NULL here, which the check accepts.
RESET lock_timeout;

ALTER TABLE "chat_room_mention" VALIDATE CONSTRAINT "chat_room_mention_network_check";
