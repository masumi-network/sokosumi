/*
  Warnings:

  - The values [AGENT_CONNECTION_FAILED,PAYMENT_NODE_CONNECTION_FAILED,PAYMENT_PENDING,PAYMENT_FAILED,INPUT_REQUIRED,PROCESSING,COMPLETED,FAILED,DISPUTE_REQUESTED,DISPUTE_RESOLVED,REFUND_RESOLVED,UNKNOWN] on the enum `JobStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `errorType` on the `Job` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OnChainTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NextJobActionErrorType" AS ENUM ('NETWORK_ERROR', 'INSUFFICIENT_FUNDS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NextJobAction" AS ENUM ('NONE', 'IGNORE', 'WAITING_FOR_MANUAL_ACTION', 'WAITING_FOR_EXTERNAL_ACTION', 'FUNDS_LOCKING_REQUESTED', 'FUNDS_LOCKING_INITIATED', 'SET_REFUND_REQUESTED_REQUESTED', 'SET_REFUND_REQUESTED_INITIATED', 'UNSET_REFUND_REQUESTED_REQUESTED', 'UNSET_REFUND_REQUESTED_INITIATED', 'WITHDRAW_FUNDS_REQUESTED', 'WITHDRAW_FUNDS_INITIATED');

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'AWAITING_INPUT', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "JobStatus_new" AS ENUM ('FUNDS_LOCKED', 'FUNDS_OR_DATUM_INVALID', 'FUNDS_WITHDRAWN', 'RESULT_SUBMITTED', 'REFUND_REQUESTED', 'REFUND_WITHDRAWN', 'DISPUTED', 'DISPUTED_WITHDRAWN');
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";
DROP TYPE "JobStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "errorType",
ADD COLUMN     "agentJobStatus" "AgentJobStatus",
ADD COLUMN     "nextAction" "NextJobAction" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "nextActionErrorNote" TEXT,
ADD COLUMN     "nextActionErrorType" "NextJobActionErrorType",
ALTER COLUMN "status" DROP NOT NULL;

-- CreateTable
CREATE TABLE "OnChainTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hash" TEXT NOT NULL,
    "status" "OnChainTransactionStatus" NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "OnChainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnChainTransaction_jobId_key" ON "OnChainTransaction"("jobId");

-- AddForeignKey
ALTER TABLE "OnChainTransaction" ADD CONSTRAINT "OnChainTransaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
