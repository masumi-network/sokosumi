-- External channel integrity: constrained access/status values, guest only on
-- external rooms, inviter rate-limit index.

-- Valid membership access values
ALTER TABLE "chat_room_user_member"
  ADD CONSTRAINT "chat_room_user_member_access_check"
  CHECK ("access" IN ('member', 'guest'));

-- Valid guest invitation statuses
ALTER TABLE "chat_room_guest_invitation"
  ADD CONSTRAINT "chat_room_guest_invitation_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'revoked', 'declined', 'expired'));

-- Guests may only exist on external channels (cross-table invariant)
CREATE OR REPLACE FUNCTION chat_room_guest_access_external_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."access" = 'guest' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "chat_room" r
      WHERE r."id" = NEW."roomId"
        AND r."discoverability" = 'external'
    ) THEN
      RAISE EXCEPTION 'guest access is only allowed on external channels'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_user_member_guest_external_only
  ON "chat_room_user_member";

CREATE TRIGGER chat_room_user_member_guest_external_only
  BEFORE INSERT OR UPDATE OF "access", "roomId"
  ON "chat_room_user_member"
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_guest_access_external_only();

-- Rate-limit lookups: inviter creates in a time window
CREATE INDEX "chat_room_guest_invitation_inviterId_createdAt_idx"
  ON "chat_room_guest_invitation" ("inviterId", "createdAt");
