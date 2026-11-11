-- CreateTable
CREATE TABLE "buzz_community" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "relayUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buzz_community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzz_identity" (
    "id" UUID NOT NULL,
    "pubkey" TEXT NOT NULL,
    "encryptedSecretKey" TEXT NOT NULL,
    "userId" TEXT,
    "sokoBotId" UUID,
    "coworkerId" TEXT,
    "encryptedApiKey" TEXT,
    "profileHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buzz_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzz_community_member" (
    "communityId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buzz_community_member_pkey" PRIMARY KEY ("communityId","identityId")
);

-- CreateTable
CREATE TABLE "buzz_channel" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "membersHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buzz_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzz_message_link" (
    "messageId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "lastEditAt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buzz_message_link_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "buzz_reaction_link" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buzz_reaction_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzz_outbox" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "messageId" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buzz_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buzz_community_organizationId_key" ON "buzz_community"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_identity_pubkey_key" ON "buzz_identity"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_identity_userId_key" ON "buzz_identity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_identity_sokoBotId_key" ON "buzz_identity"("sokoBotId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_identity_coworkerId_key" ON "buzz_identity"("coworkerId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_channel_roomId_key" ON "buzz_channel"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_channel_channelId_key" ON "buzz_channel"("channelId");

-- CreateIndex
CREATE INDEX "buzz_channel_communityId_idx" ON "buzz_channel"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_message_link_eventId_key" ON "buzz_message_link"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_reaction_link_eventId_key" ON "buzz_reaction_link"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_reaction_link_messageId_identityId_emoji_key" ON "buzz_reaction_link"("messageId", "identityId", "emoji");

-- CreateIndex
CREATE INDEX "buzz_outbox_createdAt_idx" ON "buzz_outbox"("createdAt");

-- AddForeignKey
ALTER TABLE "buzz_community" ADD CONSTRAINT "buzz_community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_identity" ADD CONSTRAINT "buzz_identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_identity" ADD CONSTRAINT "buzz_identity_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_identity" ADD CONSTRAINT "buzz_identity_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_community_member" ADD CONSTRAINT "buzz_community_member_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "buzz_community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_community_member" ADD CONSTRAINT "buzz_community_member_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "buzz_identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_channel" ADD CONSTRAINT "buzz_channel_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_channel" ADD CONSTRAINT "buzz_channel_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "buzz_community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_message_link" ADD CONSTRAINT "buzz_message_link_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_reaction_link" ADD CONSTRAINT "buzz_reaction_link_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "buzz_identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
