DELETE FROM "soko_bot_integration"
WHERE "provider" IN ('gmail', 'googlecalendar', 'outlook');

DROP INDEX "soko_bot_integration_composioAccountId_key";

ALTER TABLE "soko_bot_integration"
  DROP COLUMN "composioAccountId";
