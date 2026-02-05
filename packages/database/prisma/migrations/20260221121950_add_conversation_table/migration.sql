-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "openaiId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "metadata" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_openaiId_key" ON "conversation"("openaiId");

-- CreateIndex
CREATE INDEX "conversation_userId_idx" ON "conversation"("userId");

-- CreateIndex
CREATE INDEX "conversation_openaiId_idx" ON "conversation"("openaiId");

-- CreateIndex
CREATE INDEX "conversation_archivedAt_idx" ON "conversation"("archivedAt");

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
