-- AlterTable
ALTER TABLE "chat_channel"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'channel',
ADD COLUMN "directKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_organizationId_directKey_key" ON "chat_channel"("organizationId", "directKey");

-- CreateIndex
CREATE INDEX "chat_channel_organizationId_kind_updatedAt_idx" ON "chat_channel"("organizationId", "kind", "updatedAt");
