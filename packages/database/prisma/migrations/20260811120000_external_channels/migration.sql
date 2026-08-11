-- External channels: guest membership access + room-scoped guest invitations,
-- integrity CHECKs/triggers, and discoverability convert guard.
-- App also enforces: invitee email must match auth user; no guest-invite of
-- host-org members; convert-off-external blocked while guests/pending remain.

-- AlterTable
ALTER TABLE "chat_room_user_member" ADD COLUMN "access" TEXT NOT NULL DEFAULT 'member';

-- CreateTable
CREATE TABLE "chat_room_guest_invitation" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_room_guest_invitation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "chat_room_guest_invitation"
  ADD CONSTRAINT "chat_room_guest_invitation_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_guest_invitation"
  ADD CONSTRAINT "chat_room_guest_invitation_inviterId_fkey"
  FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_guest_invitation"
  ADD CONSTRAINT "chat_room_guest_invitation_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "chat_room_guest_invitation_roomId_status_idx"
  ON "chat_room_guest_invitation"("roomId", "status");

-- CreateIndex
CREATE INDEX "chat_room_guest_invitation_email_status_idx"
  ON "chat_room_guest_invitation"("email", "status");

-- CreateIndex
-- One pending invite per room+email (case-normalized emails stored lowercased in app)
CREATE UNIQUE INDEX "chat_room_guest_invitation_room_email_pending_uidx"
  ON "chat_room_guest_invitation" ("roomId", "email")
  WHERE "status" = 'pending';

-- CreateIndex
-- Rate-limit lookups: inviter creates in a time window
CREATE INDEX "chat_room_guest_invitation_inviterId_createdAt_idx"
  ON "chat_room_guest_invitation" ("inviterId", "createdAt");

-- CreateIndex
-- Daily global expiry sweep (status + expiresAt)
CREATE INDEX "chat_room_guest_invitation_status_expiresAt_idx"
  ON "chat_room_guest_invitation" ("status", "expiresAt");

-- Valid membership access values.
-- NOT VALID + VALIDATE: avoid a long ACCESS EXCLUSIVE write block while scanning.
ALTER TABLE "chat_room_user_member"
  ADD CONSTRAINT "chat_room_user_member_access_check"
  CHECK ("access" IN ('member', 'guest')) NOT VALID;
ALTER TABLE "chat_room_user_member"
  VALIDATE CONSTRAINT "chat_room_user_member_access_check";

-- Valid guest invitation statuses
ALTER TABLE "chat_room_guest_invitation"
  ADD CONSTRAINT "chat_room_guest_invitation_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'revoked', 'declined', 'expired')) NOT VALID;
ALTER TABLE "chat_room_guest_invitation"
  VALIDATE CONSTRAINT "chat_room_guest_invitation_status_check";

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

-- Guest invitations may only target external channels
CREATE OR REPLACE FUNCTION chat_room_guest_invitation_external_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "chat_room" r
    WHERE r."id" = NEW."roomId"
      AND r."discoverability" = 'external'
      AND r."kind" = 'channel'
  ) THEN
    RAISE EXCEPTION 'guest invitations are only allowed on external channels'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_guest_invitation_external_only
  ON "chat_room_guest_invitation";

CREATE TRIGGER chat_room_guest_invitation_external_only
  BEFORE INSERT OR UPDATE OF "roomId"
  ON "chat_room_guest_invitation"
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_guest_invitation_external_only();

-- Block discoverability flips off external while guests or live pending invites remain.
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
