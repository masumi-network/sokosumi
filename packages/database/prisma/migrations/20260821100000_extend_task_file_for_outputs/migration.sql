-- CreateEnum: TaskFileStatus for tracking output file import state
CREATE TYPE "TaskFileStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum: TaskFileOrigin to distinguish user uploads from agent outputs
CREATE TYPE "TaskFileOrigin" AS ENUM ('USER_UPLOAD', 'TASK_OUTPUT');

-- AlterTable: Add sourceUrl, status, and origin to task_file
ALTER TABLE "task_file" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "task_file" ADD COLUMN "status" "TaskFileStatus" NOT NULL DEFAULT 'READY';
ALTER TABLE "task_file" ADD COLUMN "origin" "TaskFileOrigin" NOT NULL DEFAULT 'USER_UPLOAD';

-- AlterTable: Make fileUrl nullable for PENDING task-output files
ALTER TABLE "task_file" ALTER COLUMN "fileUrl" DROP NOT NULL;

-- CreateIndex: Unique constraint for (taskId, sourceUrl) deduplication
CREATE UNIQUE INDEX "task_file_taskId_sourceUrl_key" ON "task_file"("taskId", "sourceUrl");

-- CreateIndex: Index for fetching files by status (e.g., PENDING for import)
CREATE INDEX "task_file_taskId_status_idx" ON "task_file"("taskId", "status");
