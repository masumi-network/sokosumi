-- CreateTable
CREATE TABLE "jobPurchase" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "onChainStatus" "OnChainJobStatus",
    "onChainTransactionHash" TEXT,
    "onChainTransactionStatus" "OnChainTransactionStatus",
    "resultHash" TEXT,
    "nextAction" "NextJobAction" NOT NULL DEFAULT 'NONE',
    "nextActionErrorType" "NextJobActionErrorType",
    "nextActionErrorNote" TEXT,
    "errorNote" TEXT,
    "errorNoteKey" TEXT,

    CONSTRAINT "jobPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobPurchase_externalId_key" ON "jobPurchase"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "jobPurchase_jobId_key" ON "jobPurchase"("jobId");

-- CreateIndex
CREATE INDEX "jobPurchase_jobId_idx" ON "jobPurchase"("jobId");

-- AddForeignKey
ALTER TABLE "jobPurchase" ADD CONSTRAINT "jobPurchase_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
