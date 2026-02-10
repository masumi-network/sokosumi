-- Add CANCELED to TaskStatus enum
ALTER TYPE "TaskStatus" ADD VALUE 'CANCELED';

-- Move task transaction reference onto task events
ALTER TABLE "taskEvent" ADD COLUMN "transactionId" TEXT;

ALTER TABLE "taskEvent"
  ADD CONSTRAINT "taskEvent_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "taskEvent_transactionId_idx" ON "taskEvent"("transactionId");

-- Backfill existing task transactions onto the most recent completed event per task
WITH ranked_events AS (
  SELECT
    "id",
    "taskId",
    ROW_NUMBER() OVER (PARTITION BY "taskId" ORDER BY "createdAt" DESC) AS rn
  FROM "taskEvent"
  WHERE "status" = 'COMPLETED'
)
UPDATE "taskEvent" AS te
SET "transactionId" = t."transactionId"
FROM "task" AS t
JOIN ranked_events AS re ON re."taskId" = t."id"
WHERE re."taskId" = t."id"
  AND re."id" = te."id"
  AND re.rn = 1
  AND t."transactionId" IS NOT NULL;

-- Remove task-level transaction reference to allow multiple transactions per task
ALTER TABLE "task" DROP CONSTRAINT "task_transactionId_fkey";
DROP INDEX "task_transactionId_key";
ALTER TABLE "task" DROP COLUMN "transactionId";
