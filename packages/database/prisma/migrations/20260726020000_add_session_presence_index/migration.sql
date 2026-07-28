-- CreateIndex
CREATE INDEX "session_userId_updatedAt_idx" ON "session"("userId", "updatedAt" DESC);
