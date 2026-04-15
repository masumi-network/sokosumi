-- AlterTable
ALTER TABLE "coworker" ADD COLUMN "supportsConversationsApi" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "conversation" ADD COLUMN "providerConversationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversation_providerConversationId_key" ON "conversation"("providerConversationId");

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentType" TEXT,
    "contentText" TEXT NOT NULL,
    "responsesApiResponseId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_responsesApiResponseId_key" ON "messages"("conversationId", "responsesApiResponseId");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration
INSERT INTO "messages" ("id", "conversationId", "role", "contentType", "contentText", "responsesApiResponseId", "metadata", "createdAt")
SELECT "id", "conversationId", "role", "contentType", "contentText", "responsesApiResponseId", NULL, "createdAt"
FROM "conversationItem";

-- conversationItem is retained until post-release validation; drop in a follow-up migration.
