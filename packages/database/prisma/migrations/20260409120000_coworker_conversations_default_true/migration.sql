-- Coworker chat always uses the Conversations API; backfill and default new rows to true.
UPDATE "coworker" SET "supportsConversationsApi" = true;

ALTER TABLE "coworker" ALTER COLUMN "supportsConversationsApi" SET DEFAULT true;
