-- CreateIndex
CREATE UNIQUE INDEX "task_file_taskId_fileUrl_key" ON "task_file"("taskId", "fileUrl");
