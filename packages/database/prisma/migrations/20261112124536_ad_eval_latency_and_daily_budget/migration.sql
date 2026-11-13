-- AlterTable
ALTER TABLE "ad_eval" ADD COLUMN "latencyMs" INTEGER;

-- CreateTable
CREATE TABLE "ad_eval_daily_budget" (
    "day" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "workspaceId" UUID,

    CONSTRAINT "ad_eval_daily_budget_pkey" PRIMARY KEY ("day", "scope")
);

-- CreateIndex
CREATE INDEX "ad_eval_daily_budget_workspaceId_idx" ON "ad_eval_daily_budget"("workspaceId");

-- AddForeignKey
ALTER TABLE "ad_eval_daily_budget" ADD CONSTRAINT "ad_eval_daily_budget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
