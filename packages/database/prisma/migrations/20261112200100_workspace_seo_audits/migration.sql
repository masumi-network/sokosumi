-- AlterTable
ALTER TABLE "project_seo_page" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_seo_scope" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_seo_observation" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_seo_keyword" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_seo_competitor" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_seo_analysis" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_seo_action_task" ADD COLUMN     "auditId" UUID,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "seo_audit_chat_turn" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "response" TEXT,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "scopeSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "seo_audit_chat_turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_connection" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INHERIT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "composioAccountId" TEXT,
    "entityId" TEXT,
    "authConfigId" TEXT,
    "connectedAt" TIMESTAMP(3),

    CONSTRAINT "seo_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_connection_intent" (
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "toolkit" TEXT NOT NULL,
    "authConfigId" TEXT NOT NULL,
    "connectorEntityId" TEXT NOT NULL,
    "executorEntityId" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "callbackRedeemedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "seo_connection_intent_pkey" PRIMARY KEY ("connectionId")
);

-- CreateTable
CREATE TABLE "seo_audit" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seo_audit_chat_turn_auditId_userId_createdAt_idx" ON "seo_audit_chat_turn"("auditId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "seo_audit_chat_turn_auditId_userId_status_idx" ON "seo_audit_chat_turn"("auditId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seo_audit_chat_turn_auditId_userId_idempotencyKey_key" ON "seo_audit_chat_turn"("auditId", "userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "seo_connection_composioAccountId_key" ON "seo_connection"("composioAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "seo_connection_workspaceId_userId_provider_key" ON "seo_connection"("workspaceId", "userId", "provider");

-- CreateIndex
CREATE INDEX "seo_connection_intent_workspaceId_userId_provider_expiresAt_idx" ON "seo_connection_intent"("workspaceId", "userId", "provider", "expiresAt");

-- CreateIndex
CREATE INDEX "seo_audit_workspaceId_createdAt_id_idx" ON "seo_audit"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "seo_audit_projectId_idx" ON "seo_audit"("projectId");

-- CreateIndex
CREATE INDEX "project_seo_page_auditId_createdAt_idx" ON "project_seo_page"("auditId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_page_auditId_url_key" ON "project_seo_page"("auditId", "url");

-- CreateIndex
CREATE INDEX "project_seo_scope_auditId_createdAt_idx" ON "project_seo_scope"("auditId", "createdAt");

-- CreateIndex
CREATE INDEX "project_seo_observation_auditId_ownerId_observedAt_idx" ON "project_seo_observation"("auditId", "ownerId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_observation_auditId_sourceKey_key" ON "project_seo_observation"("auditId", "sourceKey");

-- CreateIndex
CREATE INDEX "project_seo_keyword_auditId_saved_idx" ON "project_seo_keyword"("auditId", "saved");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_keyword_auditId_keywordKey_countryCode_language_key" ON "project_seo_keyword"("auditId", "keywordKey", "countryCode", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_competitor_auditId_url_key" ON "project_seo_competitor"("auditId", "url");

-- CreateIndex
CREATE INDEX "project_seo_analysis_auditId_createdAt_idx" ON "project_seo_analysis"("auditId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_analysis_auditId_idempotencyKey_key" ON "project_seo_analysis"("auditId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_action_task_auditId_observationId_actionId_key" ON "project_seo_action_task"("auditId", "observationId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_action_task_auditId_idempotencyKey_key" ON "project_seo_action_task"("auditId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "seo_audit_chat_turn" ADD CONSTRAINT "seo_audit_chat_turn_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit_chat_turn" ADD CONSTRAINT "seo_audit_chat_turn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_connection" ADD CONSTRAINT "seo_connection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_connection_intent" ADD CONSTRAINT "seo_connection_intent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit" ADD CONSTRAINT "seo_audit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit" ADD CONSTRAINT "seo_audit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_page" ADD CONSTRAINT "project_seo_page_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_scope" ADD CONSTRAINT "project_seo_scope_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_observation" ADD CONSTRAINT "project_seo_observation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_keyword" ADD CONSTRAINT "project_seo_keyword_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_competitor" ADD CONSTRAINT "project_seo_competitor_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_analysis" ADD CONSTRAINT "project_seo_analysis_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_seo_action_task" ADD CONSTRAINT "project_seo_action_task_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "project_seo_page" ADD CONSTRAINT "project_seo_page_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));

ALTER TABLE "project_seo_scope" ADD CONSTRAINT "project_seo_scope_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));

ALTER TABLE "project_seo_observation" ADD CONSTRAINT "project_seo_observation_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));

ALTER TABLE "project_seo_keyword" ADD CONSTRAINT "project_seo_keyword_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));

ALTER TABLE "project_seo_competitor" ADD CONSTRAINT "project_seo_competitor_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));

ALTER TABLE "project_seo_analysis" ADD CONSTRAINT "project_seo_analysis_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));

ALTER TABLE "project_seo_action_task" ADD CONSTRAINT "project_seo_action_task_owner_check" CHECK (("projectId" IS NOT NULL) <> ("auditId" IS NOT NULL));
