-- AlterTable
ALTER TABLE "user" ADD COLUMN "termsAccepted" BOOLEAN NOT NULL DEFAULT false;


-- Update all users to have termsAccepted set to true
UPDATE "user" SET "termsAccepted" = true;