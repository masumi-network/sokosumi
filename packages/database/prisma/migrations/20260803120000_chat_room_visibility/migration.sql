-- AlterTable
ALTER TABLE "chat_room" ADD COLUMN "visibility" TEXT;

-- Existing channels stay invite-only until an owner opts into public browse.
UPDATE "chat_room" SET "visibility" = 'private' WHERE "kind" = 'channel';

-- CreateIndex
CREATE INDEX "chat_room_organizationId_kind_visibility_archivedAt_idx" ON "chat_room"("organizationId", "kind", "visibility", "archivedAt");
