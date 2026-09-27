-- AlterTable
ALTER TABLE "table_change" ADD COLUMN     "sequence" BIGSERIAL NOT NULL;

-- AddForeignKey
ALTER TABLE "table_task_scope" ADD CONSTRAINT "table_task_scope_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
