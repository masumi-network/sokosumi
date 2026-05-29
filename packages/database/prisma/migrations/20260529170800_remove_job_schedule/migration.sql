-- Drop the agent job scheduling feature and its historical links from jobs.
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_jobScheduleId_fkey";

DROP INDEX IF EXISTS "Job_jobScheduleId_idx";

ALTER TABLE "Job" DROP COLUMN IF EXISTS "jobScheduleId";

DROP TABLE IF EXISTS "jobSchedule";

DROP TYPE IF EXISTS "ScheduleType";
