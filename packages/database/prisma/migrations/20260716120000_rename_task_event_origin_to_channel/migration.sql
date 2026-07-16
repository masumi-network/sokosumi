-- Rename TaskEventOrigin enum to Channel and origin column to channel
ALTER TYPE "TaskEventOrigin" RENAME TO "Channel";
ALTER TABLE "taskEvent" RENAME COLUMN "origin" TO "channel";
