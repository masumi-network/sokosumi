-- Block discoverability flips off external while guests or live pending invites remain.
-- Complements guest-insert trigger (guests only on external) so the invariant
-- cannot be violated by UPDATE chat_room SET discoverability = ... alone.

CREATE OR REPLACE FUNCTION chat_room_external_discoverability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."discoverability" IS DISTINCT FROM 'external' THEN
    RETURN NEW;
  END IF;

  IF NEW."discoverability" IS NOT DISTINCT FROM 'external' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "chat_room_user_member" m
    WHERE m."roomId" = OLD."id"
      AND m."access" = 'guest'
  ) THEN
    RAISE EXCEPTION 'cannot change discoverability while guest members remain'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "chat_room_guest_invitation" i
    WHERE i."roomId" = OLD."id"
      AND i."status" = 'pending'
      AND i."expiresAt" > NOW()
  ) THEN
    RAISE EXCEPTION 'cannot change discoverability while pending guest invitations remain'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_external_discoverability_guard
  ON "chat_room";

CREATE TRIGGER chat_room_external_discoverability_guard
  BEFORE UPDATE OF "discoverability"
  ON "chat_room"
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_external_discoverability_guard();
