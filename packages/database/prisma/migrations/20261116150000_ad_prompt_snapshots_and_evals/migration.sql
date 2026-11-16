-- CreateEnum
CREATE TYPE "AdFeedbackKind" AS ENUM ('THUMB', 'PAIRWISE');

-- CreateEnum
CREATE TYPE "AdPairOutcome" AS ENUM ('A', 'B', 'TIE', 'BOTH_BAD');

-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN     "creativeDirection" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "variationIndex" INTEGER;

-- AlterTable
ALTER TABLE "project_image_asset" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project_image_prompt_snapshot" (
    "jobId" UUID NOT NULL,
    "finalPrompt" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" TEXT,
    "creativeDirection" TEXT,
    "variationIndex" INTEGER,
    "brandContextHash" TEXT NOT NULL,
    "brandLook" JSONB,
    "assemblyVersion" TEXT NOT NULL,
    "experimentArm" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_image_prompt_snapshot_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "ad_eval" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "judge" JSONB,
    "judgeModel" TEXT,
    "overall" DOUBLE PRECISION,
    "costUsdMicros" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_eval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_feedback" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AdFeedbackKind" NOT NULL,
    "assetId" UUID NOT NULL,
    "otherAssetId" UUID,
    "thumb" INTEGER,
    "outcome" "AdPairOutcome",
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "batchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_event" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_ad_data_consent" (
    "workspaceId" UUID NOT NULL,
    "shareForImprovement" BOOLEAN NOT NULL DEFAULT false,
    "allowTraining" BOOLEAN NOT NULL DEFAULT false,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "workspace_ad_data_consent_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "ad_eval_workspaceId_overall_idx" ON "ad_eval"("workspaceId", "overall");

-- CreateIndex
CREATE UNIQUE INDEX "ad_eval_assetId_rubricVersion_key" ON "ad_eval"("assetId", "rubricVersion");

-- CreateIndex
CREATE INDEX "ad_feedback_workspaceId_createdAt_idx" ON "ad_feedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ad_feedback_batchId_idx" ON "ad_feedback"("batchId");

-- CreateIndex
CREATE INDEX "ad_feedback_projectId_idx" ON "ad_feedback"("projectId");

-- CreateIndex
CREATE INDEX "ad_feedback_assetId_idx" ON "ad_feedback"("assetId");

-- CreateIndex
CREATE INDEX "ad_feedback_otherAssetId_idx" ON "ad_feedback"("otherAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_feedback_userId_assetId_kind_otherAssetId_key" ON "ad_feedback"("userId", "assetId", "kind", "otherAssetId");

-- The nullable composite unique above permits duplicate NULL otherAssetId values.
-- A schema-declared partial unique enforces one THUMB per user and asset.
CREATE UNIQUE INDEX "ad_feedback_userId_assetId_thumb_key" ON "ad_feedback"("userId", "assetId") WHERE ("kind" = 'THUMB');

-- CreateIndex
CREATE INDEX "ad_event_assetId_type_idx" ON "ad_event"("assetId", "type");

-- CreateIndex
CREATE INDEX "ad_event_workspaceId_createdAt_idx" ON "ad_event"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ad_event_userId_idx" ON "ad_event"("userId");

-- CreateIndex
CREATE INDEX "workspace_ad_data_consent_decidedByUserId_idx" ON "workspace_ad_data_consent"("decidedByUserId");

-- AddForeignKey
ALTER TABLE "project_image_prompt_snapshot" ADD CONSTRAINT "project_image_prompt_snapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "project_image_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_eval" ADD CONSTRAINT "ad_eval_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "project_image_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_eval" ADD CONSTRAINT "ad_eval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_feedback" ADD CONSTRAINT "ad_feedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_feedback" ADD CONSTRAINT "ad_feedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_feedback" ADD CONSTRAINT "ad_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_feedback" ADD CONSTRAINT "ad_feedback_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "project_image_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_feedback" ADD CONSTRAINT "ad_feedback_otherAssetId_fkey" FOREIGN KEY ("otherAssetId") REFERENCES "project_image_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_event" ADD CONSTRAINT "ad_event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_event" ADD CONSTRAINT "ad_event_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "project_image_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_event" ADD CONSTRAINT "ad_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ad_data_consent" ADD CONSTRAINT "workspace_ad_data_consent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ad_data_consent" ADD CONSTRAINT "workspace_ad_data_consent_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
