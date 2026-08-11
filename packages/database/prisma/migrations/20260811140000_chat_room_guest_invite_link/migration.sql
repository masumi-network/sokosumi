-- Shareable guest invite links for external channels (SOK-770).
-- Parallel to organizationInviteLink; capability is the high-entropy `token`.

CREATE TABLE "chat_room_guest_invite_link" (
  "id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "roomId" UUID NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "useCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "chat_room_guest_invite_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_room_guest_invite_link_token_key"
  ON "chat_room_guest_invite_link"("token");

CREATE INDEX "chat_room_guest_invite_link_roomId_createdAt_idx"
  ON "chat_room_guest_invite_link"("roomId", "createdAt");

CREATE INDEX "chat_room_guest_invite_link_roomId_revokedAt_expiresAt_idx"
  ON "chat_room_guest_invite_link"("roomId", "revokedAt", "expiresAt");

CREATE INDEX "chat_room_guest_invite_link_createdByUserId_createdAt_idx"
  ON "chat_room_guest_invite_link"("createdByUserId", "createdAt");

ALTER TABLE "chat_room_guest_invite_link"
  ADD CONSTRAINT "chat_room_guest_invite_link_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_room_guest_invite_link"
  ADD CONSTRAINT "chat_room_guest_invite_link_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
