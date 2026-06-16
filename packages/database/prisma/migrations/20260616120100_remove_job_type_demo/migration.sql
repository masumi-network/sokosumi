-- Delete demo jobs and remove the DEMO JobType enum value.
DELETE FROM "Job" WHERE "jobType" = 'DEMO';

ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "demo_job_no_blockchain";

CREATE TYPE "JobType_new" AS ENUM ('FREE', 'PAID');
ALTER TABLE "Job"
  ALTER COLUMN "jobType" TYPE "JobType_new"
  USING ("jobType"::text::"JobType_new");
DROP TYPE "JobType";
ALTER TYPE "JobType_new" RENAME TO "JobType";
