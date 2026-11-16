-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN     "batchId" UUID;

-- CreateIndex
CREATE INDEX "project_image_job_projectId_batchId_idx" ON "project_image_job"("projectId", "batchId");
