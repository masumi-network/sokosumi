-- CreateTable
CREATE TABLE "conversationItem" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentType" TEXT,
    "contentText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversationItem_conversationId_idx" ON "conversationItem"("conversationId");

-- CreateIndex
CREATE INDEX "conversationItem_conversationId_createdAt_idx" ON "conversationItem"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "conversationItem" ADD CONSTRAINT "conversationItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
