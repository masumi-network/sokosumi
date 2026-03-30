-- Generalize jobShare into a shared public-share table for jobs and tasks.
ALTER TABLE "jobShare"
ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "jobShare"
ALTER COLUMN "token" SET NOT NULL;

ALTER TABLE "jobShare"
ADD COLUMN "taskId" TEXT;

CREATE UNIQUE INDEX "jobShare_taskId_key" ON "jobShare"("taskId");

ALTER TABLE "jobShare"
ADD CONSTRAINT "jobShare_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jobShare"
ADD CONSTRAINT "jobShare_single_target_check"
CHECK (
  (CASE WHEN "jobId" IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN "taskId" IS NULL THEN 0 ELSE 1 END) = 1
);
