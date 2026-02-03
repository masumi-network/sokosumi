-- Add transactionId to task and link to transaction for task-based charging
ALTER TABLE "task" ADD COLUMN "transactionId" TEXT;

CREATE UNIQUE INDEX "task_transactionId_key" ON "task"("transactionId");

ALTER TABLE "task" ADD CONSTRAINT "task_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
