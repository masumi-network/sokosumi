-- AlterTable
ALTER TABLE "user" ADD COLUMN     "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT DEFAULT '1.0';


-- Update all users to have termsAccepted set to true
UPDATE "user" SET "termsAccepted" = true, "termsAcceptedAt" = "createdAt", "termsVersion" = '1.0';