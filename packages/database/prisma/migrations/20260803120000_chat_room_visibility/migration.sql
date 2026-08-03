-- AlterTable
ALTER TABLE "chat_room" ADD COLUMN "visibility" TEXT;

-- Existing channels become org-browsable / self-joinable (same default as new channels).
UPDATE "chat_room" SET "visibility" = 'public' WHERE "kind" = 'channel';

-- CreateIndex
CREATE INDEX "chat_room_organizationId_kind_visibility_archivedAt_idx" ON "chat_room"("organizationId", "kind", "visibility", "archivedAt");
