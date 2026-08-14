-- Organization exit (chat): hard-leave every room owned by the organization.
-- Replaces demote-to-guest on member delete. Required for Better Auth
-- leaveOrganization, which does not fire afterRemoveMember (only remove-member
-- hooks run). App-layer revokeChatRoomMembershipsOnOrganizationExit still runs
-- on remove/admin for Ably + parity; trigger is the durable leave path.

DROP TRIGGER IF EXISTS chat_room_demote_external_on_member_delete ON "member";
DROP FUNCTION IF EXISTS chat_room_demote_external_on_member_delete();

CREATE OR REPLACE FUNCTION chat_room_hard_leave_on_organization_member_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_name text;
  left_room_ids uuid[];
BEGIN
  SELECT COALESCE(NULLIF(BTRIM(u."name"), ''), 'Someone')
  INTO actor_name
  FROM "user" u
  WHERE u."id" = OLD."userId";

  IF actor_name IS NULL THEN
    actor_name := 'Someone';
  END IF;

  SELECT COALESCE(array_agg(m."roomId"), ARRAY[]::uuid[])
  INTO left_room_ids
  FROM "chat_room_user_member" m
  INNER JOIN "chat_room" r ON r."id" = m."roomId"
  WHERE m."userId" = OLD."userId"
    AND r."organizationId" = OLD."organizationId";

  IF cardinality(left_room_ids) = 0 THEN
    RETURN OLD;
  END IF;

  -- Channel timeline "left" for the leaver (same shape as app membership status).
  INSERT INTO "chat_room_message" (
    "id",
    "roomId",
    "content",
    "senderUserId",
    "senderCoworkerId",
    "metadata",
    "createdAt"
  )
  SELECT
    gen_random_uuid(),
    r."id",
    actor_name || ' left',
    NULL,
    NULL,
    jsonb_build_object(
      'membership',
      jsonb_build_object(
        'action', 'left',
        'subject',
        jsonb_build_object(
          'type', 'user',
          'id', OLD."userId",
          'name', actor_name
        )
      )
    ),
    CURRENT_TIMESTAMP
  FROM "chat_room" r
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'channel';

  DELETE FROM "chat_room_read_state" rs
  WHERE rs."userId" = OLD."userId"
    AND rs."roomId" = ANY (left_room_ids);

  DELETE FROM "chat_room_user_member" m
  WHERE m."userId" = OLD."userId"
    AND m."roomId" = ANY (left_room_ids);

  -- Soft-archive channels left with zero humans (restorable).
  UPDATE "chat_room" r
  SET "archivedAt" = CURRENT_TIMESTAMP
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'channel'
    AND r."archivedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "chat_room_user_member" m
      WHERE m."roomId" = r."id"
    );

  -- Empty directs: hard-delete. Soft-archive would keep directKey and block
  -- create-or-get; product archive API already forbids archiving directs.
  DELETE FROM "chat_room" r
  WHERE r."id" = ANY (left_room_ids)
    AND r."kind" = 'direct'
    AND NOT EXISTS (
      SELECT 1
      FROM "chat_room_user_member" m
      WHERE m."roomId" = r."id"
    );

  RETURN OLD;
END;
$$;

CREATE TRIGGER chat_room_hard_leave_on_organization_member_delete
  AFTER DELETE
  ON "member"
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_hard_leave_on_organization_member_delete();
