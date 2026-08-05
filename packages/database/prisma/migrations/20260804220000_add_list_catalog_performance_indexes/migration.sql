-- CreateIndex
CREATE INDEX "Agent_isShown_status_idx" ON "Agent"("isShown", "status");

-- CreateIndex
CREATE INDEX "Job_workspaceId_createdAt_idx" ON "Job"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "taskEvent_taskId_createdAt_idx" ON "taskEvent"("taskId", "createdAt");
