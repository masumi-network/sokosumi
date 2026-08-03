-- AlterTable
ALTER TABLE "chat_room" ADD COLUMN "discoverability" TEXT;

-- Existing channels become org-browsable / self-joinable (same default as new channels).
UPDATE "chat_room" SET "discoverability" = 'public' WHERE "kind" = 'channel';

-- CreateIndex
CREATE INDEX "chat_room_organizationId_kind_discoverability_archivedAt_idx" ON "chat_room"("organizationId", "kind", "discoverability", "archivedAt");
