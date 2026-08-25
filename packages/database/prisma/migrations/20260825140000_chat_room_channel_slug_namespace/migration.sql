-- Channel slug is a Channel-only handle (ADR 0015). Directs persist null.
-- Occupancy is the Channel unique index, including private and archived rows.

DROP INDEX "chat_room_organizationId_slug_key";
DROP INDEX "chat_room_personal_creator_slug_key";

ALTER TABLE "chat_room" ALTER COLUMN "slug" DROP NOT NULL;

UPDATE "chat_room" SET "slug" = NULL WHERE "kind" = 'direct';

CREATE UNIQUE INDEX "chat_room_organizationId_channel_slug_key"
  ON "chat_room"("organizationId", "slug")
  WHERE "kind" = 'channel' AND "slug" IS NOT NULL;

ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_channel_slug_check"
  CHECK (
    ("kind" = 'channel' AND "slug" IS NOT NULL)
    OR ("kind" = 'direct' AND "slug" IS NULL)
  );
