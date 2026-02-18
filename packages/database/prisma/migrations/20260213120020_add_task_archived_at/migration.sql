ALTER TABLE "task"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "task_archivedAt_idx" ON "task"("archivedAt");
