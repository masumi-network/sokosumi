-- External channels: guest membership access + room-scoped guest invitations.
-- App enforces: only discoverability=external may have guests; invitee email
-- must match auth user; no guest-invite of host-org members.

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
CREATE INDEX "chat_room_guest_invitation_roomId_status_idx" ON "chat_room_guest_invitation"("roomId", "status");

-- CreateIndex
CREATE INDEX "chat_room_guest_invitation_email_status_idx" ON "chat_room_guest_invitation"("email", "status");

-- CreateIndex
-- One pending invite per room+email (case-normalized emails stored lowercased in app)
CREATE UNIQUE INDEX "chat_room_guest_invitation_room_email_pending_uidx"
  ON "chat_room_guest_invitation" ("roomId", "email")
  WHERE "status" = 'pending';
