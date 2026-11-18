-- CreateTable
CREATE TABLE "project_seo_suggestion" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observationId" UUID,
    "title" TEXT NOT NULL,
    "keyword" TEXT,
    "pageUrl" TEXT,
    "why" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "newText" TEXT,
    "draft" TEXT,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "doneAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_research" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_research_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_seo_suggestion_projectId_kind_status_idx" ON "project_seo_suggestion"("projectId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_suggestion_projectId_key_key" ON "project_seo_suggestion"("projectId", "key");

-- CreateIndex
CREATE INDEX "project_seo_research_projectId_kind_observedAt_idx" ON "project_seo_research"("projectId", "kind", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_research_projectId_kind_key_key" ON "project_seo_research"("projectId", "kind", "key");

-- AddForeignKey
ALTER TABLE "project_seo_suggestion" ADD CONSTRAINT "project_seo_suggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_research" ADD CONSTRAINT "project_seo_research_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
