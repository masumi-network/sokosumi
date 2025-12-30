/*
  Warnings:

  - Made the column `eventId` on table `blob` required. This step will fail if there are existing NULL values in that column.

*/
-- Step 1: Remove orphaned blobs with null eventId
-- These are blobs that were created during migration periods when the eventId relationship was temporarily removed
DELETE FROM "blob" WHERE "eventId" IS NULL;

-- Step 2: Make eventId required
ALTER TABLE "blob" ALTER COLUMN "eventId" SET NOT NULL;
