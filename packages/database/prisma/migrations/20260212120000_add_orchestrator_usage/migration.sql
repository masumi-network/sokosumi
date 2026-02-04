-- CreateTable
CREATE TABLE "orchestrator_usage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceId" TEXT,
    "orchestratorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "cents" BIGINT NOT NULL,
    "transactionId" TEXT NOT NULL,

    CONSTRAINT "orchestrator_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_usage_transactionId_key" ON "orchestrator_usage"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_usage_orchestratorId_idempotencyKey_key" ON "orchestrator_usage"("orchestratorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "orchestrator_usage_userId_organizationId_createdAt_idx" ON "orchestrator_usage"("userId", "organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
