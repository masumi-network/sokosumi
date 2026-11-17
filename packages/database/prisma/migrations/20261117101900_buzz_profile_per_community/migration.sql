-- A profile is published per community; republish only where it changed.
ALTER TABLE "buzz_community_member" ADD COLUMN "profileHash" TEXT;
ALTER TABLE "buzz_identity" DROP COLUMN "profileHash";
