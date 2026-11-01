-- A Project's Marketing strategy, one row per version (ADR 0062); at most one
-- approved per Project.

-- CreateTable
CREATE TABLE "marketing_strategy" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "plan" JSONB NOT NULL,
    "authorSokoBotId" UUID,
    "authorUserId" TEXT,
    "authorTurnId" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,

    CONSTRAINT "marketing_strategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_strategy_projectId_createdAt_idx" ON "marketing_strategy"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_strategy_one_approved_key" ON "marketing_strategy"("projectId") WHERE ("approvedAt" IS NOT NULL);

-- AddForeignKey
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_authorSokoBotId_fkey" FOREIGN KEY ("authorSokoBotId") REFERENCES "soko_bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_authorTurnId_fkey" FOREIGN KEY ("authorTurnId") REFERENCES "soko_bot_turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cuso's calendar becomes the Project's Social posts (ADR 0062): each post
-- keeps the Marketing strategy version that planned it and its planning
-- record. Replaces the calendar inside the approved version.

-- AlterTable
ALTER TABLE "social_post" ADD COLUMN     "marketingStrategyId" UUID,
ADD COLUMN     "planning" JSONB;

-- CreateIndex
CREATE INDEX "social_post_marketingStrategyId_idx" ON "social_post"("marketingStrategyId");

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_marketingStrategyId_fkey" FOREIGN KEY ("marketingStrategyId") REFERENCES "marketing_strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
