-- AlterTable
ALTER TABLE "conversationItem" ADD COLUMN "responsesApiResponseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversationItem_conversationId_responsesApiResponseId_key" ON "conversationItem"("conversationId", "responsesApiResponseId");
