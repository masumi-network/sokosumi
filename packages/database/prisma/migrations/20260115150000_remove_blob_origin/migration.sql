-- Delete orphaned INPUT blobs (those without matching JobInput)
-- These should have been migrated to Attachment table, but we clean up any remaining ones
DELETE FROM "blob"
WHERE "origin" = 'INPUT';

-- Delete any blobs without sourceUrl (shouldn't exist for OUTPUT blobs)
-- This ensures we can safely make sourceUrl NOT NULL
DELETE FROM "blob" WHERE "sourceUrl" IS NULL;

-- Drop indexes that include origin
DROP INDEX IF EXISTS "blob_status_origin_createdAt_idx";
DROP INDEX IF EXISTS "blob_eventId_origin_idx";
DROP INDEX IF EXISTS "blob_jobId_origin_idx";

-- Create new indexes without origin
CREATE INDEX "blob_status_createdAt_idx" ON "blob"("status", "createdAt");
CREATE INDEX "blob_eventId_idx" ON "blob"("eventId");

-- Remove origin column
ALTER TABLE "blob" DROP COLUMN "origin";

-- Make sourceUrl required
ALTER TABLE "blob" ALTER COLUMN "sourceUrl" SET NOT NULL;

-- Drop BlobOrigin enum
DROP TYPE IF EXISTS "BlobOrigin";
