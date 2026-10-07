-- CreateEnum
CREATE TYPE "ProjectAdMarketAdsJobStage" AS ENUM ('SERP', 'ADS', 'FAILED');

-- CreateTable
CREATE TABLE "project_ad_market_ads_job" (
    "projectId" UUID NOT NULL,
    "requestKey" TEXT NOT NULL,
    "stage" "ProjectAdMarketAdsJobStage" NOT NULL,
    "pendingTaskIds" TEXT[],
    "collected" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "nextCheckAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ad_market_ads_job_pkey" PRIMARY KEY ("projectId")
);

-- AddForeignKey
ALTER TABLE "project_ad_market_ads_job" ADD CONSTRAINT "project_ad_market_ads_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
