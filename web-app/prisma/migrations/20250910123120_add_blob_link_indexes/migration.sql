-- CreateIndex
CREATE INDEX "blob_status_origin_createdAt_idx" ON "public"."blob"("status", "origin", "createdAt");

-- CreateIndex
CREATE INDEX "blob_jobId_origin_idx" ON "public"."blob"("jobId", "origin");

-- CreateIndex
CREATE INDEX "blob_jobId_sourceUrl_idx" ON "public"."blob"("jobId", "sourceUrl");

-- CreateIndex
CREATE INDEX "blob_userId_status_idx" ON "public"."blob"("userId", "status");

-- CreateIndex
CREATE INDEX "link_jobId_idx" ON "public"."link"("jobId");
