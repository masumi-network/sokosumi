-- One-shot recovery, remove once preprod is green.
--
-- 20260825150000_soko_bot_avatars_and_requester was a short-lived rename of
-- 20260825140000_soko_bot_avatars_and_requester. Preprod had already applied
-- the original, so the renamed folder re-ran its SQL and failed on the table
-- it had itself created, leaving a failed row that blocks every later
-- `migrate deploy` with P3009.
--
-- Postgres runs each migration in a transaction and this one failed on its
-- first statement, so nothing from the retry persisted: rolled back is what
-- actually happened. The WHERE clause makes this a no-op everywhere else.
UPDATE "_prisma_migrations"
SET "rolled_back_at" = NOW()
WHERE "migration_name" = '20260825150000_soko_bot_avatars_and_requester'
  AND "finished_at" IS NULL
  AND "rolled_back_at" IS NULL;
