-- CreateTable
CREATE TABLE "jobStatus" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "status" "AgentJobStatus" NOT NULL,
    "result" TEXT,
    "input" JSONB,
    "inputSchema" JSONB,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "jobStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobStatus_externalId_idx" ON "jobStatus"("externalId");

-- CreateIndex
CREATE INDEX "jobStatus_jobId_idx" ON "jobStatus"("jobId");

-- AddForeignKey
ALTER TABLE "jobStatus" ADD CONSTRAINT "jobStatus_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
