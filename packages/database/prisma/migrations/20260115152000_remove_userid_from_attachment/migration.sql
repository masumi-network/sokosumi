-- Drop the foreign key constraint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_userId_fkey";

-- Drop the index on userId
DROP INDEX IF EXISTS "attachment_userId_idx";

-- Remove the userId column
ALTER TABLE "attachment" DROP COLUMN "userId";
