-- RELEASE GATE (greenfield hard cut — not backward-compatible with the old
-- unmerged `chat_channel*` migration chain on `codex/chat-channels`):
--
-- This migration *creates* `chat_room*` tables. It does not ALTER/rename the
-- old `chat_channel*` tables, and those four migrations are deleted from the
-- repo. Any database that already applied:
--   20260725120000_add_chat_channels
--   20260725185000_add_chat_channel_direct_messages
--   20260725200500_add_chat_channel_threads_reactions
--   20260726023000_add_chat_channel_read_states
-- must be reset or redeployed before `prisma migrate deploy`. Otherwise deploy
-- fails (missing migration files / history drift) or leaves orphan
-- `chat_channel*` tables beside the new schema.
--
-- Safe without reset: DBs that never applied the old four (e.g. main / prod).
-- Local/agent/preview DBs that did: `pnpm prisma:migrate:reset` (dev) or
-- recreate the Neon branch, then `pnpm prisma:migrate:deploy`.
--
-- See docs/superpowers/specs/2026-07-27-chats-api-and-chat-room-schema-design.md

-- CreateTable
CREATE TABLE "chat_room" (
  "id" UUID NOT NULL,
  "organizationId" TEXT,
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
-- Org-scoped slug uniqueness (channels + org-attached rooms).
CREATE UNIQUE INDEX "chat_room_organizationId_slug_key"
  ON "chat_room"("organizationId", "slug")
  WHERE "organizationId" IS NOT NULL;

-- CreateIndex
-- Future archive: create-or-get must unarchive-or-clear-directKey — archived
-- rows still occupy this unique slot while archivedAt is filtered out.
CREATE UNIQUE INDEX "chat_room_organizationId_directKey_key"
  ON "chat_room"("organizationId", "directKey")
  WHERE "organizationId" IS NOT NULL AND "directKey" IS NOT NULL;

-- CreateIndex
-- Personal (org-free) directs are keyed only by directKey.
CREATE UNIQUE INDEX "chat_room_personal_directKey_key"
  ON "chat_room"("directKey")
  WHERE "organizationId" IS NULL AND "directKey" IS NOT NULL;

-- CreateIndex
-- Personal slug uniqueness scoped to the creator (display slug only).
CREATE UNIQUE INDEX "chat_room_personal_creator_slug_key"
  ON "chat_room"("createdByUserId", "slug")
  WHERE "organizationId" IS NULL;

-- CreateIndex
CREATE INDEX "chat_room_organizationId_archivedAt_updatedAt_idx" ON "chat_room"("organizationId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "chat_room_organizationId_kind_updatedAt_idx" ON "chat_room"("organizationId", "kind", "updatedAt");

-- CreateIndex
CREATE INDEX "chat_room_createdByUserId_kind_updatedAt_idx" ON "chat_room"("createdByUserId", "kind", "updatedAt");

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
-- those rooms. Channels require an organization; personal directs may omit it.
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_kind_check"
  CHECK ("kind" IN ('channel', 'direct'));

ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_direct_key_check"
  CHECK (
    ("kind" = 'direct' AND "directKey" IS NOT NULL)
    OR ("kind" = 'channel' AND "directKey" IS NULL AND "organizationId" IS NOT NULL)
  );

ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_channel_org_check"
  CHECK (
    ("kind" = 'direct')
    OR ("kind" = 'channel' AND "organizationId" IS NOT NULL)
  );

-- Both sender columns null is valid (the sender row was deleted and the FK set
-- it null); two senders at once is not, and would make `sender` ambiguous.
ALTER TABLE "chat_room_message" ADD CONSTRAINT "chat_room_message_sender_check"
  CHECK (
    (CASE WHEN "senderUserId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "senderCoworkerId" IS NULL THEN 0 ELSE 1 END)
    <= 1
  );
