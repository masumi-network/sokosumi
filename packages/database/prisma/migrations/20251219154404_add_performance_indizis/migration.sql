-- CreateIndex
CREATE INDEX "Job_agentId_idx" ON "Job"("agentId");

-- CreateIndex
CREATE INDEX "Job_agentId_createdAt_idx" ON "Job"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "jobEvent_status_idx" ON "jobEvent"("status");

-- CreateIndex
CREATE INDEX "jobEvent_jobId_status_idx" ON "jobEvent"("jobId", "status");
