-- CreateEnum
CREATE TYPE "ContactStage" AS ENUM ('PROSPECT', 'LEAD', 'ACTIVE', 'PARTNER', 'INVESTOR', 'CUSTOMER', 'DORMANT');

-- CreateEnum
CREATE TYPE "ContactChannelType" AS ENUM ('EMAIL', 'PHONE', 'SLACK', 'LINKEDIN', 'X', 'WEBSITE', 'TELEGRAM', 'WHATSAPP', 'GITHUB', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactChannelSource" AS ENUM ('MANUAL', 'EMAIL', 'CALENDAR', 'SLACK', 'WEB_RESEARCH', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactInteractionChannel" AS ENUM ('EMAIL', 'MEETING', 'SLACK', 'CALL', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactInteractionDirection" AS ENUM ('IN', 'OUT', 'BOTH');

-- CreateEnum
CREATE TYPE "ContactActivityKind" AS ENUM ('CREATED', 'UPDATED', 'CHANNEL_ADDED', 'CHANNEL_REMOVED', 'MERGED', 'ARCHIVED', 'UNARCHIVED');

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "location" TEXT,
    "summary" TEXT,
    "whyInteresting" TEXT,
    "stage" "ContactStage" NOT NULL DEFAULT 'LEAD',
    "ownerUserId" TEXT,
    "nextStep" TEXT,
    "followUpAt" DATE,
    "avatarUrl" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "firstContactAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "interactionCount" INTEGER NOT NULL DEFAULT 0,
    "mergedIntoId" UUID,
    "createdByUserId" TEXT,
    "createdBySokoBotId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_channel" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "type" "ContactChannelType" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" "ContactChannelSource" NOT NULL DEFAULT 'MANUAL',
    "sourceUrl" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_interaction" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "userId" TEXT,
    "sokoBotId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "channel" "ContactInteractionChannel" NOT NULL,
    "direction" "ContactInteractionDirection",
    "summary" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "smartFilter" JSONB,
    "createdByUserId" TEXT,
    "createdBySokoBotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list_member" (
    "listId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "addedByUserId" TEXT,
    "addedBySokoBotId" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_member_pkey" PRIMARY KEY ("listId","contactId")
);

-- CreateTable
CREATE TABLE "contact_activity" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "userId" TEXT,
    "sokoBotId" UUID,
    "kind" "ContactActivityKind" NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_workspaceId_archivedAt_updatedAt_id_idx" ON "contact"("workspaceId", "archivedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "contact_workspaceId_lastContactAt_idx" ON "contact"("workspaceId", "lastContactAt");

-- CreateIndex
CREATE INDEX "contact_workspaceId_name_idx" ON "contact"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "contact_mergedIntoId_idx" ON "contact"("mergedIntoId");

-- CreateIndex
CREATE INDEX "contact_ownerUserId_idx" ON "contact"("ownerUserId");

-- CreateIndex
CREATE INDEX "contact_channel_contactId_idx" ON "contact_channel"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_channel_workspaceId_type_value_key" ON "contact_channel"("workspaceId", "type", "value");

-- CreateIndex
CREATE INDEX "contact_interaction_contactId_occurredAt_idx" ON "contact_interaction"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "contact_interaction_contactId_userId_idx" ON "contact_interaction"("contactId", "userId");

-- CreateIndex
CREATE INDEX "contact_interaction_userId_idx" ON "contact_interaction"("userId");

-- CreateIndex
CREATE INDEX "contact_interaction_sokoBotId_idx" ON "contact_interaction"("sokoBotId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_workspaceId_channel_sourceRef_key" ON "contact_interaction"("workspaceId", "channel", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "contact_list_workspaceId_nameKey_key" ON "contact_list"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "contact_list_member_contactId_idx" ON "contact_list_member"("contactId");

-- CreateIndex
CREATE INDEX "contact_activity_contactId_createdAt_id_idx" ON "contact_activity"("contactId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channel" ADD CONSTRAINT "contact_channel_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction" ADD CONSTRAINT "contact_interaction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction" ADD CONSTRAINT "contact_interaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction" ADD CONSTRAINT "contact_interaction_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list" ADD CONSTRAINT "contact_list_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_member" ADD CONSTRAINT "contact_list_member_listId_fkey" FOREIGN KEY ("listId") REFERENCES "contact_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_member" ADD CONSTRAINT "contact_list_member_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_activity" ADD CONSTRAINT "contact_activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

