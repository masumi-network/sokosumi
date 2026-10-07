-- Organization rejoin (chat): put a returning member back into the
-- organization's Directs they were started with.
--
-- Organization exit (`chat_room_hard_leave_on_organization_member_delete`)
-- takes the leaver out of every org room but keeps an org Direct while anyone
-- is left in it, and its participant key (`directKey`) still names them. That
-- Direct is Read-only for whoever stayed. Without this, a rejoined member is
-- never put back: create-or-get finds the Direct by its key and returns a room
-- they are not in. Channels stay as they were: rejoining does not restore them.
--
-- An AFTER INSERT trigger, like the exit trigger, so every path that adds a
-- Member (invitation accept, invite link, admin add) restores the same way.

-- Humans a Direct was started for, read from its participant key. Mirrors
-- `directKeyUserIds` in Core `routes/v1/chats/rooms/helpers.ts`:
-- `direct:v2:` keys list `type:id` pairs; a human 1:1 key is the two user ids;
-- Self Direct and AI 1:1 keys are namespaced and name no one to restore.
CREATE OR REPLACE FUNCTION chat_direct_key_user_ids(direct_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN direct_key LIKE 'direct:v2:%' THEN ARRAY(
      SELECT t.part
      FROM unnest(string_to_array(substr(direct_key, 11), ':'))
        WITH ORDINALITY AS t(part, idx)
      WHERE t.idx % 2 = 0
        AND (string_to_array(substr(direct_key, 11), ':'))[t.idx - 1] = 'user'
    )
    WHEN cardinality(string_to_array(direct_key, ':')) = 2
      THEN string_to_array(direct_key, ':')
    ELSE ARRAY[]::text[]
  END
$$;

CREATE OR REPLACE FUNCTION chat_room_restore_directs_on_organization_member_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  restored_room_ids uuid[];
BEGIN
  WITH restored AS (
    INSERT INTO "chat_room_user_member" ("id", "roomId", "userId", "access", "createdAt")
    SELECT gen_random_uuid(), r."id", NEW."userId", 'member', CURRENT_TIMESTAMP
    FROM "chat_room" r
    WHERE r."organizationId" = NEW."organizationId"
      AND r."kind" = 'direct'
      AND r."archivedAt" IS NULL
      AND r."directKey" IS NOT NULL
      AND NEW."userId" = ANY (chat_direct_key_user_ids(r."directKey"))
    ON CONFLICT ("roomId", "userId") DO NOTHING
    RETURNING "roomId"
  )
  SELECT COALESCE(array_agg("roomId"), ARRAY[]::uuid[])
  INTO restored_room_ids
  FROM restored;

  IF cardinality(restored_room_ids) = 0 THEN
    RETURN NEW;
  END IF;

  -- Exit deleted their read state, and no read state counts every message from
  -- others as unread. Set Room last-read to now: a 1:1 Direct was read-only
  -- while they were away, and in a group anything sent then went to the people
  -- who were members at the time, not to them. Thread Look markers
  -- (`chat_room_thread_read_state`) are not touched, so a Thread they followed
  -- before leaving can still show unread replies.
  INSERT INTO "chat_room_read_state" ("id", "roomId", "userId", "lastReadAt", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), room_id, NEW."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM unnest(restored_room_ids) AS room_id
  ON CONFLICT ("roomId", "userId") DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_restore_directs_on_organization_member_insert ON "member";

CREATE TRIGGER chat_room_restore_directs_on_organization_member_insert
  AFTER INSERT
  ON "member"
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_restore_directs_on_organization_member_insert();
