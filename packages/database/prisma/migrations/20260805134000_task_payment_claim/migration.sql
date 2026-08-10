-- CreateEnum
CREATE TYPE "TaskPaymentClaimStatus" AS ENUM ('PENDING', 'PURCHASED', 'REFUNDED');

-- CreateTable
CREATE TABLE "task_payment_claim" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "network" TEXT NOT NULL,
    "blockchainIdentifier" TEXT NOT NULL,
    "purchasePayload" JSONB NOT NULL,
    "status" "TaskPaymentClaimStatus" NOT NULL DEFAULT 'PENDING',
    "externalPurchaseId" TEXT,
    "failureReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "processingToken" TEXT,
    "taskEventId" TEXT,
    "transactionId" TEXT NOT NULL,
    "refundTransactionId" TEXT,

    CONSTRAINT "task_payment_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_payment_claim_network_blockchainIdentifier_key" ON "task_payment_claim"("network", "blockchainIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "task_payment_claim_taskEventId_key" ON "task_payment_claim"("taskEventId");

-- CreateIndex
CREATE UNIQUE INDEX "task_payment_claim_transactionId_key" ON "task_payment_claim"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "task_payment_claim_refundTransactionId_key" ON "task_payment_claim"("refundTransactionId");

-- CreateIndex
CREATE INDEX "task_payment_claim_network_status_nextAttemptAt_idx" ON "task_payment_claim"("network", "status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "task_payment_claim" ADD CONSTRAINT "task_payment_claim_taskEventId_fkey" FOREIGN KEY ("taskEventId") REFERENCES "taskEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_payment_claim" ADD CONSTRAINT "task_payment_claim_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_payment_claim" ADD CONSTRAINT "task_payment_claim_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
