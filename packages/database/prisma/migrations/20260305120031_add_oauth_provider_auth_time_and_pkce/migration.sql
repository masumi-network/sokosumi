-- Better Auth v1.5 oauth-provider schema additions
ALTER TABLE "oauthClient"
  ADD COLUMN IF NOT EXISTS "requirePKCE" BOOLEAN;

ALTER TABLE "oauthRefreshToken"
  ADD COLUMN IF NOT EXISTS "authTime" TIMESTAMP(3);
