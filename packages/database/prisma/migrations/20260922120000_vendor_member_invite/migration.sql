-- Developer self-service vendors (POST /v1/vendors) made vendor-admin available
-- to every account, which turned add-member-by-email into a user-directory
-- oracle. This migration adds a pending-invite model so member-add creates an
-- invitation instead of a membership, and adds vendor provenance/visibility so
-- self-service vendors are capped and stay off the global grant picker until a
-- platform admin lists them.

-- CreateEnum
CREATE TYPE "VendorMemberInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- AlterTable
-- createdByUserId: the developer who self-created the vendor (null for
-- platform-created). listed: whether the vendor shows in GET /v1/vendors.
-- Existing rows are platform-created, so they default to listed = true.
ALTER TABLE "vendor" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "vendor" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "vendor_member_invite" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "VendorMemberRole" NOT NULL,
    "status" "VendorMemberInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT,
    "acceptedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "vendor_member_invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_member_invite_vendorId_status_idx" ON "vendor_member_invite"("vendorId", "status");

-- CreateIndex
CREATE INDEX "vendor_member_invite_email_status_idx" ON "vendor_member_invite"("email", "status");

-- CreateIndex
-- Emails are normalized before storage, so index the stored column directly.
CREATE UNIQUE INDEX "vendor_member_invite_vendorId_email_pending_key" ON "vendor_member_invite"("vendorId", "email") WHERE "status" = 'PENDING';

-- CreateIndex
-- One self-service vendor per user. PostgreSQL UNIQUE allows many NULLs, so
-- platform-created vendors (createdByUserId null) are not capped.
CREATE UNIQUE INDEX "vendor_createdByUserId_key" ON "vendor"("createdByUserId");

-- CreateIndex
CREATE INDEX "vendor_member_invite_invitedById_createdAt_idx" ON "vendor_member_invite"("invitedById", "createdAt");

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_member_invite" ADD CONSTRAINT "vendor_member_invite_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_member_invite" ADD CONSTRAINT "vendor_member_invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_member_invite" ADD CONSTRAINT "vendor_member_invite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
