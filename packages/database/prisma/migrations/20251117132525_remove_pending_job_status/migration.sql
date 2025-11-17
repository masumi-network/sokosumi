/*
  Warnings:

  - The values [PENDING] on the enum `AgentJobStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- Update any PENDING values to RUNNING before removing the enum value
UPDATE "Job" SET "agentJobStatus" = 'RUNNING' WHERE "agentJobStatus" = 'PENDING';
UPDATE "jobStatus" SET "status" = 'RUNNING' WHERE "status" = 'PENDING';

-- AlterEnum
BEGIN;
CREATE TYPE "AgentJobStatus_new" AS ENUM ('AWAITING_PAYMENT', 'AWAITING_INPUT', 'RUNNING', 'COMPLETED', 'FAILED');
ALTER TABLE "Job" ALTER COLUMN "agentJobStatus" TYPE "AgentJobStatus_new" USING ("agentJobStatus"::text::"AgentJobStatus_new");
ALTER TABLE "jobStatus" ALTER COLUMN "status" TYPE "AgentJobStatus_new" USING ("status"::text::"AgentJobStatus_new");
ALTER TYPE "AgentJobStatus" RENAME TO "AgentJobStatus_old";
ALTER TYPE "AgentJobStatus_new" RENAME TO "AgentJobStatus";
DROP TYPE "public"."AgentJobStatus_old";
COMMIT;
