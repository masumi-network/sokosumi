/*
  Warnings:

  - You are about to drop the column `errorType` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Job` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OnChainTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NextJobActionErrorType" AS ENUM ('NETWORK_ERROR', 'INSUFFICIENT_FUNDS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NextJobAction" AS ENUM ('NONE', 'IGNORE', 'WAITING_FOR_MANUAL_ACTION', 'WAITING_FOR_EXTERNAL_ACTION', 'FUNDS_LOCKING_REQUESTED', 'FUNDS_LOCKING_INITIATED', 'SET_REFUND_REQUESTED_REQUESTED', 'SET_REFUND_REQUESTED_INITIATED', 'UNSET_REFUND_REQUESTED_REQUESTED', 'UNSET_REFUND_REQUESTED_INITIATED', 'WITHDRAW_REFUND_REQUESTED', 'WITHDRAW_REFUND_INITIATED');

-- CreateEnum
CREATE TYPE "OnChainJobStatus" AS ENUM ('FUNDS_LOCKED', 'FUNDS_OR_DATUM_INVALID', 'FUNDS_WITHDRAWN', 'RESULT_SUBMITTED', 'REFUND_REQUESTED', 'REFUND_WITHDRAWN', 'DISPUTED', 'DISPUTED_WITHDRAWN');

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'AWAITING_INPUT', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "errorType",
DROP COLUMN "status",
ADD COLUMN     "agentJobStatus" "AgentJobStatus",
ADD COLUMN     "nextAction" "NextJobAction" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "nextActionErrorNote" TEXT,
ADD COLUMN     "nextActionErrorType" "NextJobActionErrorType",
ADD COLUMN     "onChainStatus" "OnChainJobStatus";

-- DropEnum
DROP TYPE "JobStatus";

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
