-- CreateIndex
CREATE INDEX CONCURRENTLY "task_file_status_origin_createdAt_idx" ON "task_file"("status", "origin", "createdAt");
