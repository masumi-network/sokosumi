-- AlterTable
ALTER TABLE "coworker" ADD COLUMN "supportsConversationsApi" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "conversation" ADD COLUMN "providerConversationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversation_providerConversationId_key" ON "conversation"("providerConversationId");

-- CreateTable
CREATE TABLE "conversationMessage" (
    "id" UUID NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentType" TEXT,
    "contentText" TEXT NOT NULL,
    "responsesApiResponseId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversationMessage_conversationId_responsesApiResponseId_key" ON "conversationMessage"("conversationId", "responsesApiResponseId");

-- CreateIndex
CREATE INDEX "conversationMessage_conversationId_idx" ON "conversationMessage"("conversationId");

-- CreateIndex
CREATE INDEX "conversationMessage_conversationId_createdAt_idx" ON "conversationMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "conversationMessage" ADD CONSTRAINT "conversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration
INSERT INTO "conversationMessage" ("id", "conversationId", "role", "contentType", "contentText", "responsesApiResponseId", "metadata", "createdAt")
SELECT "id"::uuid, "conversationId", "role", "contentType", "contentText", "responsesApiResponseId", NULL, "createdAt"
FROM "conversationItem";

-- conversationItem is retained until post-release validation; drop in a follow-up migration.
