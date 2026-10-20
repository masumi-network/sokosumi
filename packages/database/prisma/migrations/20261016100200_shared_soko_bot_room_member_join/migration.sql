-- Shared Soko Bot room (chat): every member of the organization is a member
-- of each shared bot's room (`soko_bot.sharedRoomId`), so they can read it and
-- post in it through the ordinary room membership checks.
--
-- An AFTER INSERT trigger on "member", like the Direct restore trigger, so
-- every path that adds a Member (invitation accept, invite link, admin add)
-- joins the same way, in the same transaction. Organization exit needs no
-- counterpart: `chat_room_hard_leave_on_organization_member_delete` already
-- takes the leaver out of every room of the organization, these included.
-- The room is created with the organization's members already in it, so
-- this only covers people who join later. Room creation passes
-- isolationLevel ReadCommitted explicitly (never the database default, never
-- the serializable helper): its first statement locks the organization row (FOR NO KEY
-- UPDATE), and a later statement reads the members. The share lock below
-- conflicts with that lock in both orders. A join that starts after it waits
-- and then sees the new room here. A join that started before it makes the
-- creation wait, and the creation's later member read sees that member.
-- REPEATABLE READ or SERIALIZABLE would fix the snapshot at the lock
-- statement and miss that member.
--
-- Only a shared bot (no owner) has a shared room.
ALTER TABLE "soko_bot" DROP CONSTRAINT IF EXISTS "soko_bot_shared_room_owner_check";
ALTER TABLE "soko_bot" ADD CONSTRAINT "soko_bot_shared_room_owner_check" CHECK ("sharedRoomId" IS NULL OR "userId" IS NULL);

CREATE OR REPLACE FUNCTION chat_room_join_shared_soko_bot_rooms_on_member_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  joined_room_ids uuid[];
BEGIN
  PERFORM 1 FROM "organization" WHERE "id" = NEW."organizationId" FOR SHARE;

  WITH joined AS (
    INSERT INTO "chat_room_user_member" ("id", "roomId", "userId", "access", "createdAt")
    SELECT gen_random_uuid(), r."id", NEW."userId", 'member', CURRENT_TIMESTAMP
    FROM "soko_bot" b
    JOIN "workspace" w ON w."id" = b."workspaceId"
    JOIN "chat_room" r ON r."id" = b."sharedRoomId"
    WHERE b."userId" IS NULL
      AND b."deletedAt" IS NULL
      AND w."organizationId" = NEW."organizationId"
      AND r."organizationId" = NEW."organizationId"
      AND r."kind" = 'channel'
      AND r."archivedAt" IS NULL
    ON CONFLICT ("roomId", "userId") DO NOTHING
    RETURNING "roomId"
  )
  SELECT COALESCE(array_agg("roomId"), ARRAY[]::uuid[])
  INTO joined_room_ids
  FROM joined;

  IF cardinality(joined_room_ids) = 0 THEN
    RETURN NEW;
  END IF;

  -- A newcomer starts caught up: what was said before they joined was not
  -- addressed to them.
  INSERT INTO "chat_room_read_state" ("id", "roomId", "userId", "lastReadAt", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), room_id, NEW."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM unnest(joined_room_ids) AS room_id
  ON CONFLICT ("roomId", "userId") DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_join_shared_soko_bot_rooms_on_member_insert ON "member";

CREATE TRIGGER chat_room_join_shared_soko_bot_rooms_on_member_insert
  AFTER INSERT
  ON "member"
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_join_shared_soko_bot_rooms_on_member_insert();
