-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('JOB', 'TASK', 'CONVERSATION', 'BILLING', 'SYSTEM');

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "messageParams" TEXT NOT NULL,
    "metadata" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_id_idx" ON "notification"("userId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notification_userId_isRead_idx" ON "notification"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "notification_userId_kind_referenceId_eventId_key" ON "notification"("userId", "kind", "referenceId", "eventId");

-- CreateIndex
CREATE INDEX "notification_eventId_idx" ON "notification"("eventId");

-- CreateIndex
CREATE INDEX "notification_kind_eventId_idx" ON "notification"("kind", "eventId");
