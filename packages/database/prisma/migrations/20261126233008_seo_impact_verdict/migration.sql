-- CreateTable
CREATE TABLE "project_seo_impact_verdict" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "changeSource" TEXT NOT NULL,
    "suggestionId" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "changeEarliest" TIMESTAMP(3),
    "changeLatest" TIMESTAMP(3),
    "pageUrl" TEXT NOT NULL,
    "title" TEXT,
    "kind" TEXT,
    "property" TEXT,
    "state" TEXT NOT NULL DEFAULT 'waiting_crawl',
    "reason" TEXT,
    "lastInspectedAt" TIMESTAMP(3),
    "crawledAt" TIMESTAMP(3),
    "windowStart" DATE,
    "windowEnd" DATE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "waits" INTEGER NOT NULL DEFAULT 0,
    "taskId" TEXT,
    "input" JSONB,
    "verdict" JSONB,
    "verdictAt" TIMESTAMP(3),
    "closingEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_impact_verdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_impact_verdict_taskId_key" ON "project_seo_impact_verdict"("taskId");

-- CreateIndex
CREATE INDEX "project_seo_impact_verdict_state_idx" ON "project_seo_impact_verdict"("state");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_impact_verdict_suggestionId_changedAt_key" ON "project_seo_impact_verdict"("suggestionId", "changedAt");

-- AddForeignKey
ALTER TABLE "project_seo_impact_verdict" ADD CONSTRAINT "project_seo_impact_verdict_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_impact_verdict" ADD CONSTRAINT "project_seo_impact_verdict_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "project_seo_suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
