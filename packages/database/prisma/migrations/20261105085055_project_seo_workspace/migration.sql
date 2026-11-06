-- CreateTable
CREATE TABLE "project_seo_page" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "relationship" TEXT NOT NULL DEFAULT 'primary',
    "relatedToPageId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_scope" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pageIds" UUID[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_observation" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "sourceFileId" TEXT,
    "ownerId" TEXT,
    "pageIds" UUID[],
    "scopeVersion" INTEGER NOT NULL DEFAULT 0,
    "artifactHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_seo_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_keyword" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "keywordKey" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "pageId" UUID,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "saved" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_competitor" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_analysis" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "taskId" TEXT,
    "pageIds" UUID[],
    "scopeVersion" INTEGER NOT NULL DEFAULT 0,
    "request" JSONB NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_seo_action_task" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "actionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_seo_action_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_seo_page_projectId_createdAt_idx" ON "project_seo_page"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_page_projectId_url_key" ON "project_seo_page"("projectId", "url");

-- CreateIndex
CREATE INDEX "project_seo_scope_projectId_createdAt_idx" ON "project_seo_scope"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_seo_observation_projectId_ownerId_observedAt_idx" ON "project_seo_observation"("projectId", "ownerId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_observation_projectId_sourceKey_key" ON "project_seo_observation"("projectId", "sourceKey");

-- CreateIndex
CREATE INDEX "project_seo_keyword_projectId_saved_idx" ON "project_seo_keyword"("projectId", "saved");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_keyword_projectId_keywordKey_countryCode_langua_key" ON "project_seo_keyword"("projectId", "keywordKey", "countryCode", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_competitor_projectId_url_key" ON "project_seo_competitor"("projectId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_analysis_taskId_key" ON "project_seo_analysis"("taskId");

-- CreateIndex
CREATE INDEX "project_seo_analysis_projectId_createdAt_idx" ON "project_seo_analysis"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_analysis_projectId_idempotencyKey_key" ON "project_seo_analysis"("projectId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_action_task_projectId_observationId_actionId_key" ON "project_seo_action_task"("projectId", "observationId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_action_task_projectId_idempotencyKey_key" ON "project_seo_action_task"("projectId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "project_seo_page" ADD CONSTRAINT "project_seo_page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_scope" ADD CONSTRAINT "project_seo_scope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_observation" ADD CONSTRAINT "project_seo_observation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_observation" ADD CONSTRAINT "project_seo_observation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_keyword" ADD CONSTRAINT "project_seo_keyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_competitor" ADD CONSTRAINT "project_seo_competitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_analysis" ADD CONSTRAINT "project_seo_analysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_action_task" ADD CONSTRAINT "project_seo_action_task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
