-- Safe rename to preserve existing data
-- Output -> Result hash rename aligned with purchase API

-- AlterTable
ALTER TABLE "Job" RENAME COLUMN "outputHash" TO "resultHash";


