-- Drop the foreign key constraint
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_userId_fkey";

-- Drop the index on userId
DROP INDEX IF EXISTS "blob_userId_status_idx";

-- Remove the userId column
ALTER TABLE "blob" DROP COLUMN "userId";
