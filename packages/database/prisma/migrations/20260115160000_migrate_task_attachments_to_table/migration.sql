-- Make jobInputId nullable
ALTER TABLE "attachment" ALTER COLUMN "jobInputId" DROP NOT NULL;

-- Add taskId and taskCommentId columns
ALTER TABLE "attachment" ADD COLUMN "taskId" TEXT;
ALTER TABLE "attachment" ADD COLUMN "taskCommentId" TEXT;

-- Add foreign key constraints
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachment" ADD CONSTRAINT "attachment_taskCommentId_fkey"
  FOREIGN KEY ("taskCommentId") REFERENCES "taskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop existing unique constraint
DROP INDEX IF EXISTS "attachment_jobInputId_url_key";

-- Create partial unique indexes (only when the foreign key is set)
CREATE UNIQUE INDEX "attachment_jobInputId_url_key"
  ON "attachment"("jobInputId", "url") WHERE "jobInputId" IS NOT NULL;

CREATE UNIQUE INDEX "attachment_taskId_url_key"
  ON "attachment"("taskId", "url") WHERE "taskId" IS NOT NULL;

CREATE UNIQUE INDEX "attachment_taskCommentId_url_key"
  ON "attachment"("taskCommentId", "url") WHERE "taskCommentId" IS NOT NULL;

-- Add indexes
CREATE INDEX "attachment_taskId_idx" ON "attachment"("taskId");
CREATE INDEX "attachment_taskCommentId_idx" ON "attachment"("taskCommentId");

-- Remove attachments columns (no data migration needed - fields are empty)
ALTER TABLE "task" DROP COLUMN "attachments";
ALTER TABLE "taskComment" DROP COLUMN "attachments";
