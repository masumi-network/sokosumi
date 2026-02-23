/*
  Add Better Auth admin plugin fields for role-based admin and impersonation support.
  No data migration is included.
*/

ALTER TABLE "user"
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN "banned" BOOLEAN DEFAULT false,
ADD COLUMN "banReason" TEXT,
ADD COLUMN "banExpires" TIMESTAMP(3);

ALTER TABLE "session"
ADD COLUMN "impersonatedBy" TEXT;
