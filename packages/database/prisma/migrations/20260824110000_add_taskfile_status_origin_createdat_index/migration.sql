-- CreateIndex
CREATE INDEX "task_file_status_origin_createdAt_idx" ON "task_file"("status", "origin", "createdAt");
