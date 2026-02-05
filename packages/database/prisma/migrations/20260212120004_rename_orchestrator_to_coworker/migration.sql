-- Rename tables
ALTER TABLE "orchestrator" RENAME TO "coworker";
ALTER TABLE "orchestrator_usage" RENAME TO "coworker_usage";

-- Rename columns
ALTER TABLE "task" RENAME COLUMN "orchestratorId" TO "coworkerId";
ALTER TABLE "taskEvent" RENAME COLUMN "orchestratorId" TO "coworkerId";
ALTER TABLE "coworker_usage" RENAME COLUMN "orchestratorId" TO "coworkerId";

-- Rename constraints and indexes for coworker table
ALTER TABLE "coworker" RENAME CONSTRAINT "orchestrator_pkey" TO "coworker_pkey";
ALTER INDEX "orchestrator_slug_key" RENAME TO "coworker_slug_key";
ALTER TABLE "coworker" RENAME CONSTRAINT "orchestrator_userId_fkey" TO "coworker_userId_fkey";

-- Rename task foreign key constraints
ALTER TABLE "task" RENAME CONSTRAINT "task_orchestratorId_fkey" TO "task_coworkerId_fkey";
ALTER TABLE "taskEvent" RENAME CONSTRAINT "taskEvent_orchestratorId_fkey" TO "taskEvent_coworkerId_fkey";

-- Rename constraints and indexes for coworker usage
ALTER TABLE "coworker_usage" RENAME CONSTRAINT "orchestrator_usage_pkey" TO "coworker_usage_pkey";
ALTER INDEX "orchestrator_usage_transactionId_key" RENAME TO "coworker_usage_transactionId_key";
ALTER INDEX "orchestrator_usage_orchestratorId_idempotencyKey_key" RENAME TO "coworker_usage_coworkerId_idempotencyKey_key";
ALTER INDEX "orchestrator_usage_userId_organizationId_createdAt_idx" RENAME TO "coworker_usage_userId_organizationId_createdAt_idx";
ALTER TABLE "coworker_usage" RENAME CONSTRAINT "orchestrator_usage_orchestratorId_fkey" TO "coworker_usage_coworkerId_fkey";
ALTER TABLE "coworker_usage" RENAME CONSTRAINT "orchestrator_usage_userId_fkey" TO "coworker_usage_userId_fkey";
ALTER TABLE "coworker_usage" RENAME CONSTRAINT "orchestrator_usage_organizationId_fkey" TO "coworker_usage_organizationId_fkey";
ALTER TABLE "coworker_usage" RENAME CONSTRAINT "orchestrator_usage_transactionId_fkey" TO "coworker_usage_transactionId_fkey";

-- Update API key metadata payloads
UPDATE "apikey"
SET "metadata" = replace("metadata", '"orchestratorId"', '"coworkerId"')
WHERE "metadata" LIKE '%"orchestratorId"%';
