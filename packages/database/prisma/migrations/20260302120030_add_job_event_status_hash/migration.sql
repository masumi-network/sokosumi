-- Add persisted canonical status response hash for sync dedupe
ALTER TABLE "jobEvent"
ADD COLUMN "statusHash" TEXT;
