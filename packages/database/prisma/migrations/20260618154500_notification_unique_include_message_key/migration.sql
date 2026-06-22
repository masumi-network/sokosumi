-- DropIndex
DROP INDEX "notification_userId_kind_referenceId_eventId_key";

-- CreateIndex
CREATE UNIQUE INDEX "notification_userId_kind_referenceId_eventId_messageKey_key" ON "notification"("userId", "kind", "referenceId", "eventId", "messageKey");
