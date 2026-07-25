-- CreateTable
CREATE TABLE "chat_channel" (
  "id" UUID NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "topic" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,

  CONSTRAINT "chat_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_channel_user_member" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_channel_user_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_channel_coworker_member" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "coworkerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_channel_coworker_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_channel_message" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "senderUserId" TEXT,
  "senderCoworkerId" TEXT,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_channel_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_channel_mention" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "coworkerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "providerConversationId" TEXT,
  "providerResponseId" TEXT,
  "responseMessageId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_channel_mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_organizationId_slug_key" ON "chat_channel"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "chat_channel_organizationId_archivedAt_updatedAt_idx" ON "chat_channel"("organizationId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_user_member_channelId_userId_key" ON "chat_channel_user_member"("channelId", "userId");

-- CreateIndex
CREATE INDEX "chat_channel_user_member_userId_idx" ON "chat_channel_user_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_coworker_member_channelId_coworkerId_key" ON "chat_channel_coworker_member"("channelId", "coworkerId");

-- CreateIndex
CREATE INDEX "chat_channel_coworker_member_coworkerId_idx" ON "chat_channel_coworker_member"("coworkerId");

-- CreateIndex
CREATE INDEX "chat_channel_message_channelId_createdAt_idx" ON "chat_channel_message"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_channel_message_senderUserId_idx" ON "chat_channel_message"("senderUserId");

-- CreateIndex
CREATE INDEX "chat_channel_message_senderCoworkerId_idx" ON "chat_channel_message"("senderCoworkerId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_mention_messageId_coworkerId_key" ON "chat_channel_mention"("messageId", "coworkerId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_mention_responseMessageId_key" ON "chat_channel_mention"("responseMessageId");

-- CreateIndex
CREATE INDEX "chat_channel_mention_coworkerId_status_idx" ON "chat_channel_mention"("coworkerId", "status");

-- AddForeignKey
ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_user_member" ADD CONSTRAINT "chat_channel_user_member_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_user_member" ADD CONSTRAINT "chat_channel_user_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_coworker_member" ADD CONSTRAINT "chat_channel_coworker_member_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_coworker_member" ADD CONSTRAINT "chat_channel_coworker_member_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_message" ADD CONSTRAINT "chat_channel_message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_message" ADD CONSTRAINT "chat_channel_message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_message" ADD CONSTRAINT "chat_channel_message_senderCoworkerId_fkey" FOREIGN KEY ("senderCoworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_mention" ADD CONSTRAINT "chat_channel_mention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_channel_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_mention" ADD CONSTRAINT "chat_channel_mention_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_mention" ADD CONSTRAINT "chat_channel_mention_responseMessageId_fkey" FOREIGN KEY ("responseMessageId") REFERENCES "chat_channel_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
