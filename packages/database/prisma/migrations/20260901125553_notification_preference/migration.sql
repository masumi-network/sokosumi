-- SOK-877: per-user Notification delivery preference.
-- Prisma's diff also wanted to drop eight hand-written partial unique indexes
-- it cannot express in schema.prisma (chat_room slugs and direct keys, the
-- guest invitation, the live orchestrator, the planned occurrence). Those
-- drops are removed: they enforce live constraints and are unrelated to this
-- change.

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_userId_category_channel_key" ON "notification_preference"("userId", "category", "channel");

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
