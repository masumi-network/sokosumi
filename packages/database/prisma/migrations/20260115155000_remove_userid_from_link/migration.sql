-- Drop the foreign key constraint
ALTER TABLE "link" DROP CONSTRAINT IF EXISTS "link_userId_fkey";

-- Remove the userId column
ALTER TABLE "link" DROP COLUMN "userId";
