-- Cuso's calendar becomes the Project's Social posts (ADR 0062): each post
-- keeps the Marketing strategy version that planned it and its planning
-- record. Replaces the calendar inside the approved version and cmo_hire's
-- production.

-- AlterTable
ALTER TABLE "social_post" ADD COLUMN     "marketingStrategyId" UUID,
ADD COLUMN     "planning" JSONB;

-- CreateIndex
CREATE INDEX "social_post_marketingStrategyId_idx" ON "social_post"("marketingStrategyId");

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_marketingStrategyId_fkey" FOREIGN KEY ("marketingStrategyId") REFERENCES "marketing_strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
