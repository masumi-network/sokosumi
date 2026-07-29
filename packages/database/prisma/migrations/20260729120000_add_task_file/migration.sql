-- CreateTable
CREATE TABLE "task_file" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" BIGINT,
    "uploadedByUserId" TEXT,
    "uploadedByCoworkerId" TEXT,

    CONSTRAINT "task_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_file_taskId_createdAt_idx" ON "task_file"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_file_uploadedByUserId_idx" ON "task_file"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "task_file_uploadedByCoworkerId_idx" ON "task_file"("uploadedByCoworkerId");

-- AddForeignKey
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_uploadedByCoworkerId_fkey" FOREIGN KEY ("uploadedByCoworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
