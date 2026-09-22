-- One self-service vendor per user. Postgres UNIQUE allows many NULLs, so
-- platform-created vendors (createdByUserId null) are not capped.
-- Replaces the non-unique lookup index from 20260922120000_vendor_member_invite.
DROP INDEX IF EXISTS "vendor_createdByUserId_idx";

CREATE UNIQUE INDEX "vendor_createdByUserId_key" ON "vendor"("createdByUserId");
