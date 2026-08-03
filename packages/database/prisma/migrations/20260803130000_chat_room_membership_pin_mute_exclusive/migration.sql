-- Prefer mute if both somehow set (sidebar chrome already prefers mute).
UPDATE "chat_room_user_member"
SET "pinnedAt" = NULL
WHERE "pinnedAt" IS NOT NULL AND "mutedAt" IS NOT NULL;

-- Product invariant Prisma cannot express: pin and mute are mutually exclusive.
ALTER TABLE "chat_room_user_member"
  ADD CONSTRAINT "chat_room_user_member_pin_mute_exclusive_check"
  CHECK (NOT ("pinnedAt" IS NOT NULL AND "mutedAt" IS NOT NULL));
