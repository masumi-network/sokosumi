-- DropEnum not needed; replace action with eventId on notification.

DROP INDEX "notification_userId_kind_referenceId_action_key";

ALTER TABLE "notification" DROP COLUMN "action";

ALTER TABLE "notification" ADD COLUMN "eventId" TEXT NOT NULL;

CREATE UNIQUE INDEX "notification_userId_kind_referenceId_eventId_key" ON "notification"("userId", "kind", "referenceId", "eventId");

CREATE INDEX "notification_eventId_idx" ON "notification"("eventId");

CREATE INDEX "notification_kind_eventId_idx" ON "notification"("kind", "eventId");
