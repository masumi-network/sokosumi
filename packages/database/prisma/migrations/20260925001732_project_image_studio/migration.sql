-- Project image studio: eve conversation binding, fal generation jobs,
-- immutable image versions, and per-version review decisions.
--
-- Two unique indexes carry safety properties the application relies on and
-- must not be relaxed:
--   project_image_job_projectId_idempotencyKey_key  -- a replayed submission
--     returns the existing job instead of buying a second image
--   project_image_asset_rootId_version_key          -- two settlements racing
--     inside one lineage cannot both take the same version number
-- project_image_asset has no UPDATE path in the application: versions are
-- immutable, and a review lives in its own row so it cannot be inherited.

-- CreateEnum
CREATE TYPE "ProjectImageJobKind" AS ENUM ('GENERATE', 'EDIT');

-- CreateEnum
CREATE TYPE "ProjectImageJobStatus" AS ENUM ('PENDING', 'SUBMITTING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'SUBMISSION_UNCERTAIN', 'ORPHANED');

-- CreateEnum
CREATE TYPE "ProjectImageReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "project_image_session" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "eveSessionId" TEXT NOT NULL,
    "title" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_image_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_image_job" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sessionId" UUID,
    "requestedByUserId" TEXT NOT NULL,
    "kind" "ProjectImageJobKind" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "referenceAssetIds" UUID[],
    "parentAssetId" UUID,
    "status" "ProjectImageJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "submitLeaseAt" TIMESTAMP(3),
    "submitAttempts" INTEGER NOT NULL DEFAULT 0,
    "falRequestId" TEXT,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "polledAt" TIMESTAMP(3),

    CONSTRAINT "project_image_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_image_asset" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "rootId" UUID NOT NULL,
    "parentId" UUID,
    "version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "project_image_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_image_review" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assetId" UUID NOT NULL,
    "decision" "ProjectImageReviewDecision" NOT NULL,
    "feedback" TEXT,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_image_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_image_session_eveSessionId_key" ON "project_image_session"("eveSessionId");

-- CreateIndex
CREATE INDEX "project_image_session_projectId_lastActivityAt_idx" ON "project_image_session"("projectId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "project_image_session_workspaceId_idx" ON "project_image_session"("workspaceId");

-- CreateIndex
CREATE INDEX "project_image_session_createdByUserId_idx" ON "project_image_session"("createdByUserId");

-- CreateIndex
CREATE INDEX "project_image_job_projectId_createdAt_idx" ON "project_image_job"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_image_job_status_updatedAt_idx" ON "project_image_job"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "project_image_job_workspaceId_idx" ON "project_image_job"("workspaceId");

-- CreateIndex
CREATE INDEX "project_image_job_sessionId_idx" ON "project_image_job"("sessionId");

-- CreateIndex
CREATE INDEX "project_image_job_requestedByUserId_idx" ON "project_image_job"("requestedByUserId");

-- CreateIndex
CREATE INDEX "project_image_job_parentAssetId_idx" ON "project_image_job"("parentAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "project_image_job_projectId_idempotencyKey_key" ON "project_image_job"("projectId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_image_job_falRequestId_key" ON "project_image_job"("falRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "project_image_asset_jobId_key" ON "project_image_asset"("jobId");

-- CreateIndex
CREATE INDEX "project_image_asset_projectId_createdAt_idx" ON "project_image_asset"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_image_asset_workspaceId_idx" ON "project_image_asset"("workspaceId");

-- CreateIndex
CREATE INDEX "project_image_asset_parentId_idx" ON "project_image_asset"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "project_image_asset_rootId_version_key" ON "project_image_asset"("rootId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "project_image_review_assetId_key" ON "project_image_review"("assetId");

-- CreateIndex
CREATE INDEX "project_image_review_decidedByUserId_idx" ON "project_image_review"("decidedByUserId");

-- AddForeignKey
ALTER TABLE "project_image_session" ADD CONSTRAINT "project_image_session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_session" ADD CONSTRAINT "project_image_session_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_session" ADD CONSTRAINT "project_image_session_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "project_image_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_asset" ADD CONSTRAINT "project_image_asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_asset" ADD CONSTRAINT "project_image_asset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_asset" ADD CONSTRAINT "project_image_asset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "project_image_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_asset" ADD CONSTRAINT "project_image_asset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "project_image_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_review" ADD CONSTRAINT "project_image_review_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "project_image_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_review" ADD CONSTRAINT "project_image_review_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
