-- CreateEnum
CREATE TYPE "FileSourceKind" AS ENUM ('DRIVE_UPLOAD', 'TASK_OUTPUT', 'PROJECT_DOCUMENT', 'NATIVE_TABLE', 'STUDIO_ASSET');

-- CreateEnum
CREATE TYPE "FileSourceScope" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "FileResourceLifecycle" AS ENUM ('PENDING', 'ACTIVE', 'TOMBSTONED');

-- CreateEnum
CREATE TYPE "FileExtractionState" AS ENUM ('PENDING', 'RUNNING', 'INDEXED', 'PARTIAL', 'UNSUPPORTED', 'ENCRYPTED', 'QUARANTINED', 'FAILED');

-- CreateEnum
CREATE TYPE "FileLabelKind" AS ENUM ('TAG', 'CATEGORY');

-- CreateEnum
CREATE TYPE "FileMetadataProvenance" AS ENUM ('MANUAL', 'MODEL', 'RULE');

-- CreateEnum
CREATE TYPE "FileMetadataState" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FileFieldOverrideDecision" AS ENUM ('PIN', 'REJECT', 'ALLOW');

-- CreateEnum
CREATE TYPE "FileIndexJobPipeline" AS ENUM ('EXTRACT', 'SUGGEST');

-- CreateEnum
CREATE TYPE "FileIndexJobState" AS ENUM ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FileIndexArtifactState" AS ENUM ('ACTIVE', 'ABANDONED', 'PURGED');

-- CreateTable
CREATE TABLE "file_evidence_scope" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceKind" "FileSourceKind" NOT NULL,
    "sourceScope" "FileSourceScope" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actorKinds" TEXT[],
    "scopeVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "file_evidence_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_resource" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceKind" "FileSourceKind" NOT NULL,
    "sourceScope" "FileSourceScope" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerOrganizationId" TEXT,
    "sourceTaskId" TEXT,
    "sourceProjectId" UUID,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "metadataRevision" INTEGER NOT NULL DEFAULT 1,
    "aclRevision" INTEGER NOT NULL DEFAULT 1,
    "lifecycle" "FileResourceLifecycle" NOT NULL DEFAULT 'PENDING',
    "tombstonedAt" TIMESTAMP(3),
    "lineageId" UUID,

    CONSTRAINT "file_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_version" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resourceId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "etag" TEXT,
    "checksum" TEXT,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "extractionState" "FileExtractionState" NOT NULL DEFAULT 'PENDING',
    "extractionCoverage" DOUBLE PRECISION,
    "extractionReason" TEXT,
    "extractorVersion" TEXT,
    "textRevision" INTEGER NOT NULL DEFAULT 0,
    "indexGeneration" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "file_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_chunk" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionId" UUID NOT NULL,
    "chunkId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "anchor" JSONB,
    "text" TEXT NOT NULL,
    "evidenceScopeId" UUID NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "inputDigest" TEXT NOT NULL,

    CONSTRAINT "file_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_label" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "FileLabelKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "aliases" TEXT[],
    "mergedIntoId" UUID,
    "archivedAt" TIMESTAMP(3),
    "vocabularyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,

    CONSTRAINT "workspace_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_label" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resourceId" UUID NOT NULL,
    "labelId" UUID NOT NULL,
    "state" "FileMetadataState" NOT NULL,
    "provenance" "FileMetadataProvenance" NOT NULL,
    "evidenceScopeId" UUID NOT NULL,
    "evidenceDigest" TEXT,
    "evidenceSnippet" TEXT,
    "evidenceAnchor" JSONB,
    "contentRevision" INTEGER NOT NULL,
    "vocabularyVersion" INTEGER NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "file_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_project_link" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resourceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "state" "FileMetadataState" NOT NULL,
    "provenance" "FileMetadataProvenance" NOT NULL,
    "evidenceScopeId" UUID NOT NULL,
    "evidenceDigest" TEXT,
    "evidenceSnippet" TEXT,
    "contentRevision" INTEGER NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "file_project_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_field_override" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resourceId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "labelId" UUID,
    "decision" "FileFieldOverrideDecision" NOT NULL,
    "evidenceScopeId" UUID NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "vocabularyVersion" INTEGER NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_field_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_lineage" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceKind" "FileSourceKind" NOT NULL,
    "sourceScope" "FileSourceScope" NOT NULL,
    "rootId" TEXT NOT NULL,
    "groupRevision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "file_lineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_collection" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "sortBy" TEXT,
    "sortOrder" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "file_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_index_job" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resourceId" UUID NOT NULL,
    "pipeline" "FileIndexJobPipeline" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "requiredScopeVersion" INTEGER NOT NULL,
    "desiredGeneration" INTEGER NOT NULL,
    "state" "FileIndexJobState" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "file_index_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_index_artifact" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jobId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "fence" INTEGER NOT NULL,
    "namespace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" "FileIndexArtifactState" NOT NULL DEFAULT 'ACTIVE',
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "file_index_artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_authorization_admission" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" UUID NOT NULL,
    "actorFingerprint" TEXT NOT NULL,
    "epochVector" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "file_authorization_admission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_evidence_scope_workspaceId_scopeVersion_idx" ON "file_evidence_scope"("workspaceId", "scopeVersion");

-- CreateIndex
CREATE UNIQUE INDEX "file_evidence_scope_source_key" ON "file_evidence_scope"("workspaceId", "sourceKind", "sourceScope", "sourceId");

-- CreateIndex
CREATE INDEX "file_resource_workspaceId_lifecycle_updatedAt_idx" ON "file_resource"("workspaceId", "lifecycle", "updatedAt");

-- CreateIndex
CREATE INDEX "file_resource_workspaceId_normalizedName_idx" ON "file_resource"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "file_resource_lineageId_idx" ON "file_resource"("lineageId");

-- CreateIndex
CREATE INDEX "file_resource_sourceTaskId_idx" ON "file_resource"("sourceTaskId");

-- CreateIndex
CREATE INDEX "file_resource_sourceProjectId_idx" ON "file_resource"("sourceProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "file_resource_source_key" ON "file_resource"("workspaceId", "sourceKind", "sourceScope", "sourceId");

-- CreateIndex
CREATE INDEX "file_version_resourceId_createdAt_idx" ON "file_version"("resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "file_version_extractionState_idx" ON "file_version"("extractionState");

-- CreateIndex
CREATE UNIQUE INDEX "file_version_revision_key" ON "file_version"("resourceId", "revision");

-- CreateIndex
CREATE INDEX "file_chunk_versionId_ordinal_idx" ON "file_chunk"("versionId", "ordinal");

-- CreateIndex
CREATE INDEX "file_chunk_evidenceScopeId_idx" ON "file_chunk"("evidenceScopeId");

-- CreateIndex
CREATE UNIQUE INDEX "file_chunk_version_key" ON "file_chunk"("versionId", "chunkId");

-- CreateIndex
CREATE INDEX "workspace_label_workspaceId_kind_archivedAt_idx" ON "workspace_label"("workspaceId", "kind", "archivedAt");

-- CreateIndex
CREATE INDEX "workspace_label_mergedIntoId_idx" ON "workspace_label"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_label_name_key" ON "workspace_label"("workspaceId", "kind", "normalizedName");

-- CreateIndex
CREATE INDEX "file_label_resourceId_state_idx" ON "file_label"("resourceId", "state");

-- CreateIndex
CREATE INDEX "file_label_labelId_state_idx" ON "file_label"("labelId", "state");

-- CreateIndex
CREATE INDEX "file_label_evidenceScopeId_idx" ON "file_label"("evidenceScopeId");

-- CreateIndex
CREATE UNIQUE INDEX "file_label_assignment_key" ON "file_label"("resourceId", "labelId", "evidenceScopeId");

-- CreateIndex
CREATE INDEX "file_project_link_resourceId_state_idx" ON "file_project_link"("resourceId", "state");

-- CreateIndex
CREATE INDEX "file_project_link_projectId_state_idx" ON "file_project_link"("projectId", "state");

-- CreateIndex
CREATE INDEX "file_project_link_evidenceScopeId_idx" ON "file_project_link"("evidenceScopeId");

-- CreateIndex
CREATE UNIQUE INDEX "file_project_link_key" ON "file_project_link"("resourceId", "projectId", "evidenceScopeId");

-- CreateIndex
CREATE INDEX "file_field_override_resourceId_idx" ON "file_field_override"("resourceId");

-- CreateIndex
CREATE INDEX "file_field_override_labelId_idx" ON "file_field_override"("labelId");

-- CreateIndex
CREATE INDEX "file_field_override_evidenceScopeId_idx" ON "file_field_override"("evidenceScopeId");

-- CreateIndex
CREATE UNIQUE INDEX "file_field_override_key" ON "file_field_override"("resourceId", "field", "labelId", "evidenceScopeId");

-- CreateIndex
CREATE INDEX "file_lineage_workspaceId_idx" ON "file_lineage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "file_lineage_root_key" ON "file_lineage"("workspaceId", "sourceKind", "sourceScope", "rootId");

-- CreateIndex
CREATE INDEX "file_collection_workspaceId_isShared_idx" ON "file_collection"("workspaceId", "isShared");

-- CreateIndex
CREATE UNIQUE INDEX "file_collection_name_key" ON "file_collection"("workspaceId", "ownerUserId", "name");

-- CreateIndex
CREATE INDEX "file_index_job_state_runAfter_idx" ON "file_index_job"("state", "runAfter");

-- CreateIndex
CREATE INDEX "file_index_job_resourceId_pipeline_idx" ON "file_index_job"("resourceId", "pipeline");

-- CreateIndex
CREATE UNIQUE INDEX "file_index_job_dedupe_key" ON "file_index_job"("dedupeKey");

-- CreateIndex
CREATE INDEX "file_index_artifact_state_createdAt_idx" ON "file_index_artifact"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_index_artifact_namespace_key" ON "file_index_artifact"("jobId", "attempt", "namespace");

-- CreateIndex
CREATE INDEX "file_authorization_admission_workspaceId_admittedAt_idx" ON "file_authorization_admission"("workspaceId", "admittedAt");

-- CreateIndex
CREATE INDEX "file_authorization_admission_payloadDigest_idx" ON "file_authorization_admission"("payloadDigest");

-- AddForeignKey
ALTER TABLE "file_evidence_scope" ADD CONSTRAINT "file_evidence_scope_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_resource" ADD CONSTRAINT "file_resource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_resource" ADD CONSTRAINT "file_resource_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "file_lineage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_version" ADD CONSTRAINT "file_version_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_chunk" ADD CONSTRAINT "file_chunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "file_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_chunk" ADD CONSTRAINT "file_chunk_evidenceScopeId_fkey" FOREIGN KEY ("evidenceScopeId") REFERENCES "file_evidence_scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_label" ADD CONSTRAINT "workspace_label_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_label" ADD CONSTRAINT "workspace_label_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "workspace_label"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_label" ADD CONSTRAINT "file_label_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_label" ADD CONSTRAINT "file_label_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "workspace_label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_label" ADD CONSTRAINT "file_label_evidenceScopeId_fkey" FOREIGN KEY ("evidenceScopeId") REFERENCES "file_evidence_scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_project_link" ADD CONSTRAINT "file_project_link_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_project_link" ADD CONSTRAINT "file_project_link_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_project_link" ADD CONSTRAINT "file_project_link_evidenceScopeId_fkey" FOREIGN KEY ("evidenceScopeId") REFERENCES "file_evidence_scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_field_override" ADD CONSTRAINT "file_field_override_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_field_override" ADD CONSTRAINT "file_field_override_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "workspace_label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_field_override" ADD CONSTRAINT "file_field_override_evidenceScopeId_fkey" FOREIGN KEY ("evidenceScopeId") REFERENCES "file_evidence_scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_lineage" ADD CONSTRAINT "file_lineage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_collection" ADD CONSTRAINT "file_collection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_index_job" ADD CONSTRAINT "file_index_job_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_index_artifact" ADD CONSTRAINT "file_index_artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "file_index_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_authorization_admission" ADD CONSTRAINT "file_authorization_admission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only objects Prisma cannot express. Mirrored by comments on FileChunk
-- and FileResource in schema.prisma.

-- Substring filename search without a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text search over extracted passages. 'simple' keeps tokens unstemmed,
-- so an English, German and Spanish corpus share one predictable index
-- instead of one language's stemmer silently mangling another's terms.
-- Written by the indexer in the same statement that inserts the chunk; a
-- GENERATED column reads back as a column default and permanently drifts.
ALTER TABLE "file_chunk" ADD COLUMN "search_vector" tsvector;

CREATE INDEX "file_chunk_search_vector_idx" ON "file_chunk" USING GIN ("search_vector");

-- Exact and prefix filename matching inside one workspace. text_pattern_ops
-- makes `LIKE 'name%'` an index scan regardless of collation.
CREATE INDEX "file_resource_normalized_name_prefix_idx"
  ON "file_resource" ("workspaceId", "normalizedName" text_pattern_ops);

CREATE INDEX "file_resource_normalized_name_trgm_idx"
  ON "file_resource" USING GIN ("normalizedName" gin_trgm_ops);
