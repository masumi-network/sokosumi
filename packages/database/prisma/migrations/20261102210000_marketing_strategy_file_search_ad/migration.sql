-- AlterTable
ALTER TABLE "marketing_strategy_file" ADD COLUMN     "adAccountId" UUID,
ADD COLUMN     "adCampaignId" TEXT,
ADD COLUMN     "searchAd" JSONB;
