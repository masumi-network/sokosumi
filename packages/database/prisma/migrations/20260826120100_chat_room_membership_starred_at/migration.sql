ALTER TABLE "chat_room_user_member"
  RENAME COLUMN "pinnedAt" TO "starredAt";

DROP INDEX IF EXISTS "chat_room_user_member_userId_pinnedAt_idx";

CREATE INDEX "chat_room_user_member_userId_starredAt_idx"
  ON "chat_room_user_member"("userId", "starredAt");

ALTER TABLE "chat_room_user_member"
  DROP CONSTRAINT IF EXISTS "chat_room_user_member_pin_mute_exclusive_check";

ALTER TABLE "chat_room_user_member"
  ADD CONSTRAINT "chat_room_user_member_star_mute_exclusive_check"
  CHECK (NOT ("starredAt" IS NOT NULL AND "mutedAt" IS NOT NULL));
