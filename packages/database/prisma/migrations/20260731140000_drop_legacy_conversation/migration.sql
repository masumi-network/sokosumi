-- Drop legacy Sokosumi conversation storage and CONVERSATION history/notification kinds (SOK-671).
BEGIN;

DELETE FROM "history" WHERE "kind" = 'CONVERSATION';
DELETE FROM "notification" WHERE "kind" = 'CONVERSATION';

DROP TRIGGER IF EXISTS history_conversation_sync ON "conversation";
DROP FUNCTION IF EXISTS sync_history_from_conversation();
DROP FUNCTION IF EXISTS upsert_history_conversation(UUID);

DROP TABLE IF EXISTS "conversationMessage";
DROP TABLE IF EXISTS "conversation";

CREATE TYPE "HistoryKind_new" AS ENUM ('TASK', 'JOB');
ALTER TABLE "history"
  ALTER COLUMN "kind" TYPE "HistoryKind_new"
  USING ("kind"::text::"HistoryKind_new");
ALTER TYPE "HistoryKind" RENAME TO "HistoryKind_old";
ALTER TYPE "HistoryKind_new" RENAME TO "HistoryKind";
DROP TYPE "HistoryKind_old";

CREATE TYPE "NotificationKind_new" AS ENUM ('JOB', 'TASK', 'BILLING', 'SYSTEM');
ALTER TABLE "notification"
  ALTER COLUMN "kind" TYPE "NotificationKind_new"
  USING ("kind"::text::"NotificationKind_new");
ALTER TYPE "NotificationKind" RENAME TO "NotificationKind_old";
ALTER TYPE "NotificationKind_new" RENAME TO "NotificationKind";
DROP TYPE "NotificationKind_old";

COMMIT;
