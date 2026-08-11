-- Allow shareable guest invite links with no hard expiry (SOK-770 follow-up).
ALTER TABLE "chat_room_guest_invite_link"
  ALTER COLUMN "expiresAt" DROP NOT NULL;
