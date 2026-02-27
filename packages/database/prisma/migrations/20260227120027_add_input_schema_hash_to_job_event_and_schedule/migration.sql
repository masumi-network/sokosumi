-- Add input schema hash columns for job event and schedule
ALTER TABLE "jobEvent"
ADD COLUMN "inputSchemaHash" TEXT;

ALTER TABLE "jobSchedule"
ADD COLUMN "inputSchemaHash" TEXT;
