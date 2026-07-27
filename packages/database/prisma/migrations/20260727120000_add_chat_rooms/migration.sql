-- CreateTable
CREATE TABLE "chat_room" (
  "id" UUID NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'channel',
  "directKey" TEXT,
  "topic" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,

  CONSTRAINT "chat_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_user_member" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_room_user_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_coworker_member" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "coworkerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_room_coworker_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_message" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "parentMessageId" UUID,
  "senderUserId" TEXT,
  "senderCoworkerId" TEXT,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_room_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_reaction" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_room_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_read_state" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_room_read_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_mention" (
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

  CONSTRAINT "chat_room_mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_organizationId_slug_key" ON "chat_room"("organizationId", "slug");

-- CreateIndex
-- Future archive: create-or-get must unarchive-or-clear-directKey — archived
-- rows still occupy this unique slot while archivedAt is filtered out.
CREATE UNIQUE INDEX "chat_room_organizationId_directKey_key" ON "chat_room"("organizationId", "directKey");

-- CreateIndex
CREATE INDEX "chat_room_organizationId_archivedAt_updatedAt_idx" ON "chat_room"("organizationId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "chat_room_organizationId_kind_updatedAt_idx" ON "chat_room"("organizationId", "kind", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_user_member_roomId_userId_key" ON "chat_room_user_member"("roomId", "userId");

-- CreateIndex
CREATE INDEX "chat_room_user_member_userId_idx" ON "chat_room_user_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_coworker_member_roomId_coworkerId_key" ON "chat_room_coworker_member"("roomId", "coworkerId");

-- CreateIndex
CREATE INDEX "chat_room_coworker_member_coworkerId_idx" ON "chat_room_coworker_member"("coworkerId");

-- CreateIndex
CREATE INDEX "chat_room_message_roomId_createdAt_idx" ON "chat_room_message"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_room_message_roomId_parentMessageId_createdAt_idx" ON "chat_room_message"("roomId", "parentMessageId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_room_message_parentMessageId_createdAt_idx" ON "chat_room_message"("parentMessageId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_room_message_senderUserId_idx" ON "chat_room_message"("senderUserId");

-- CreateIndex
CREATE INDEX "chat_room_message_senderCoworkerId_idx" ON "chat_room_message"("senderCoworkerId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_reaction_messageId_userId_emoji_key" ON "chat_room_reaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "chat_room_reaction_messageId_emoji_idx" ON "chat_room_reaction"("messageId", "emoji");

-- CreateIndex
CREATE INDEX "chat_room_reaction_userId_idx" ON "chat_room_reaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_read_state_roomId_userId_key" ON "chat_room_read_state"("roomId", "userId");

-- CreateIndex
CREATE INDEX "chat_room_read_state_userId_idx" ON "chat_room_read_state"("userId");

-- CreateIndex
CREATE INDEX "chat_room_read_state_roomId_lastReadAt_idx" ON "chat_room_read_state"("roomId", "lastReadAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_mention_messageId_coworkerId_key" ON "chat_room_mention"("messageId", "coworkerId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_mention_responseMessageId_key" ON "chat_room_mention"("responseMessageId");

-- CreateIndex
CREATE INDEX "chat_room_mention_coworkerId_status_idx" ON "chat_room_mention"("coworkerId", "status");

-- AddForeignKey
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_user_member" ADD CONSTRAINT "chat_room_user_member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_user_member" ADD CONSTRAINT "chat_room_user_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_coworker_member" ADD CONSTRAINT "chat_room_coworker_member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_coworker_member" ADD CONSTRAINT "chat_room_coworker_member_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_message" ADD CONSTRAINT "chat_room_message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_message" ADD CONSTRAINT "chat_room_message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_message" ADD CONSTRAINT "chat_room_message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_message" ADD CONSTRAINT "chat_room_message_senderCoworkerId_fkey" FOREIGN KEY ("senderCoworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_reaction" ADD CONSTRAINT "chat_room_reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_reaction" ADD CONSTRAINT "chat_room_reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_read_state" ADD CONSTRAINT "chat_room_read_state_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_read_state" ADD CONSTRAINT "chat_room_read_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_mention" ADD CONSTRAINT "chat_room_mention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_mention" ADD CONSTRAINT "chat_room_mention_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_mention" ADD CONSTRAINT "chat_room_mention_responseMessageId_fkey" FOREIGN KEY ("responseMessageId") REFERENCES "chat_room_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Product invariants Prisma cannot express: `kind` is a closed set, and
-- `directKey` is the identity of a direct room, so it must exist for exactly
-- those rooms. Without this a mistyped `kind` silently creates a room no
-- create-or-get lookup can ever find again.
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_kind_check"
  CHECK ("kind" IN ('channel', 'direct'));

ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_direct_key_check"
  CHECK (
    ("kind" = 'direct' AND "directKey" IS NOT NULL)
    OR ("kind" = 'channel' AND "directKey" IS NULL)
  );

-- Both sender columns null is valid (the sender row was deleted and the FK set
-- it null); two senders at once is not, and would make `sender` ambiguous.
ALTER TABLE "chat_room_message" ADD CONSTRAINT "chat_room_message_sender_check"
  CHECK (
    (CASE WHEN "senderUserId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "senderCoworkerId" IS NULL THEN 0 ELSE 1 END)
    <= 1
  );
