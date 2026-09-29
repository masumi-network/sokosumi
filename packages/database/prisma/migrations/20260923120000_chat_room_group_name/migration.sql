-- Group name: an optional shared label on a group Direct, separate from the
-- stored room name (ADR-0040). Null means unnamed. Channels never carry one.

ALTER TABLE "chat_room" ADD COLUMN "groupName" TEXT;

ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_group_name_direct_check"
  CHECK ("groupName" IS NULL OR "kind" = 'direct');
