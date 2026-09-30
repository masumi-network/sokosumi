-- Display name and avatar for native-looking social post previews (SOK-1242).
ALTER TABLE "project_social_connection" ADD COLUMN "displayName" TEXT,
ADD COLUMN "avatarUrl" TEXT;
