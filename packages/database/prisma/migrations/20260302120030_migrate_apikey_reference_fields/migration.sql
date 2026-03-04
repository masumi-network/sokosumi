-- Drop user-based foreign key before switching to generic references
ALTER TABLE "apikey" DROP CONSTRAINT IF EXISTS "apikey_userId_fkey";

-- Better Auth v1.5 API key schema changes
ALTER TABLE "apikey" RENAME COLUMN "userId" TO "referenceId";
ALTER TABLE "apikey" ADD COLUMN "configId" TEXT NOT NULL DEFAULT 'default';

-- Keep lookups aligned with Better Auth plugin schema indexes
CREATE INDEX IF NOT EXISTS "apikey_configId_idx" ON "apikey"("configId");
CREATE INDEX IF NOT EXISTS "apikey_referenceId_idx" ON "apikey"("referenceId");
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey"("key");
