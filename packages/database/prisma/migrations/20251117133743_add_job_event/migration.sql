-- CreateTable
CREATE TABLE "jobEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "result" TEXT,
    "input" TEXT,
    "inputHash" TEXT,
    "signature" TEXT,
    "inputSchema" TEXT,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "jobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobEvent_externalId_idx" ON "jobEvent"("externalId");

-- CreateIndex
CREATE INDEX "jobEvent_jobId_idx" ON "jobEvent"("jobId");

-- AddForeignKey
ALTER TABLE "jobEvent" ADD CONSTRAINT "jobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
