-- Re-run the 20261016100100_soko_bot_owner_scope_columns backfills for rows the
-- previous release wrote after that migration: it created personal bots and
-- integrations without the new columns. Personal bots only; a shared bot has
-- no owner to copy.

UPDATE "soko_bot"
SET "createdByUserId" = "userId"
WHERE "createdByUserId" IS NULL AND "userId" IS NOT NULL;

UPDATE "soko_bot_integration" AS i
SET "connectorUserId" = b."userId"
FROM "soko_bot" AS b
WHERE b."id" = i."sokoBotId"
  AND i."connectorUserId" IS NULL
  AND b."userId" IS NOT NULL;
