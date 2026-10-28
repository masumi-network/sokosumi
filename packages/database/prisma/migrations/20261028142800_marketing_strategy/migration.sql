-- A Project's Marketing strategy, one row per version (ADR 0062); at most one
-- approved per Project. Replaces cmo_hire's strategy and its history.

-- CreateTable
CREATE TABLE "marketing_strategy" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "plan" JSONB NOT NULL,
    "authorSokoBotId" UUID,
    "authorUserId" TEXT,
    "turnId" UUID,
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
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

