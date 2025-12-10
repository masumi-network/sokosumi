-- Migration: JobEvent to JobInput and JobStatus
-- This migration:
-- 1. Creates JobInput and JobStatus tables
-- 2. Migrates first JobEvent per Job to JobInput (dummy event)
-- 3. Migrates all JobEvents to JobStatus (first event's JobStatus links to JobInput)
-- 4. Adds jobStatusId and jobInputId columns to Blob table, jobStatusId to Link table
-- 5. Updates Blob references: first event blobs get both jobStatusId and jobInputId, others get jobStatusId
-- 6. Updates Link references from jobEventId to jobStatusId
-- 7. Adds foreign key constraints and indexes
-- 8. Removes jobEventId columns and constraints
-- 9. Drops JobEvent table

-- ============================================================================
-- STEP 1: Create JobInput table
-- ============================================================================
CREATE TABLE "JobInput" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "jobId" TEXT NOT NULL,
    "inputSchema" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "signature" TEXT,

    CONSTRAINT "JobInput_pkey" PRIMARY KEY ("id")
);

-- Create indexes for JobInput
CREATE INDEX "JobInput_externalId_idx" ON "JobInput"("externalId");

-- Add foreign key for JobInput
ALTER TABLE "JobInput" ADD CONSTRAINT "JobInput_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- STEP 2: Create JobStatus table
-- ============================================================================
CREATE TABLE "jobStatus" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "jobId" TEXT NOT NULL,
    "inputId" TEXT,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "inputSchema" TEXT,
    "result" TEXT,

    CONSTRAINT "jobStatus_pkey" PRIMARY KEY ("id")
);

-- Create indexes for JobStatus
CREATE INDEX "jobStatus_externalId_idx" ON "jobStatus"("externalId");
CREATE INDEX "jobStatus_jobId_idx" ON "jobStatus"("jobId");
CREATE UNIQUE INDEX "jobStatus_inputId_key" ON "jobStatus"("inputId");

-- Add foreign keys for JobStatus
ALTER TABLE "jobStatus" ADD CONSTRAINT "jobStatus_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jobStatus" ADD CONSTRAINT "jobStatus_inputId_fkey"
    FOREIGN KEY ("inputId") REFERENCES "JobInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- STEP 3: Create mapping table to track JobEvent to JobInput/JobStatus migration
-- ============================================================================
CREATE TABLE "_job_event_migration_mapping" (
    job_event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    is_first_event BOOLEAN NOT NULL,
    job_input_id TEXT,
    job_status_id TEXT NOT NULL
);

-- ============================================================================
-- STEP 4: Populate mapping table
-- ============================================================================
-- Identify first event per job (by createdAt) and all other events
INSERT INTO "_job_event_migration_mapping" (job_event_id, job_id, is_first_event, job_input_id, job_status_id)
SELECT
    je.id AS job_event_id,
    je."jobId" AS job_id,
    (je."createdAt" = first_event.first_created_at) AS is_first_event,
    CASE
        WHEN je."createdAt" = first_event.first_created_at THEN
            -- Generate JobInput ID for first event
            md5(random()::text || je.id::text || 'input' || extract(epoch from now())::text) || substr(md5(random()::text), 1, 8)
        ELSE NULL
    END AS job_input_id,
    -- Generate JobStatus ID for all events
    md5(random()::text || je.id::text || 'status' || extract(epoch from now())::text) || substr(md5(random()::text), 1, 8) AS job_status_id
FROM "jobEvent" je
INNER JOIN (
    SELECT "jobId", MIN("createdAt") AS first_created_at
    FROM "jobEvent"
    GROUP BY "jobId"
) first_event ON je."jobId" = first_event."jobId";

-- ============================================================================
-- STEP 5: Migrate first JobEvent per Job to JobInput
-- ============================================================================
INSERT INTO "JobInput" (
    id,
    "createdAt",
    "updatedAt",
    "externalId",
    "jobId",
    "inputSchema",
    "input",
    "inputHash",
    "signature"
)
SELECT
    m.job_input_id,
    je."createdAt",
    je."updatedAt",
    je."externalId",
    je."jobId",
    -- Handle null inputSchema for dummy events
    COALESCE(je."inputSchema", '{}') AS "inputSchema",
    -- Handle null input for dummy events
    COALESCE(je."input", '') AS "input",
    -- Handle null inputHash for dummy events (use empty string hash)
    COALESCE(je."inputHash", md5('')) AS "inputHash",
    je."signature"
FROM "jobEvent" je
INNER JOIN "_job_event_migration_mapping" m ON je.id = m.job_event_id
WHERE m.is_first_event = true AND m.job_input_id IS NOT NULL;

-- ============================================================================
-- STEP 6: Migrate all JobEvents to JobStatus
-- ============================================================================
INSERT INTO "jobStatus" (
    id,
    "createdAt",
    "updatedAt",
    "externalId",
    "jobId",
    "inputId",
    "status",
    "inputSchema",
    "result"
)
SELECT
    m.job_status_id,
    je."createdAt",
    je."updatedAt",
    je."externalId",
    je."jobId",
    -- Link to JobInput only for first event
    CASE
        WHEN m.is_first_event THEN m.job_input_id
        ELSE NULL
    END AS "inputId",
    je."status",
    je."inputSchema",
    je."result"
FROM "jobEvent" je
INNER JOIN "_job_event_migration_mapping" m ON je.id = m.job_event_id;

-- ============================================================================
-- STEP 7: Add jobStatusId and jobInputId columns to Blob and Link tables
-- ============================================================================

-- Add jobStatusId column to blob (nullable initially)
ALTER TABLE "blob" ADD COLUMN "jobStatusId" TEXT;

-- Add jobInputId column to blob (nullable - for blobs from first event/JobInput)
ALTER TABLE "blob" ADD COLUMN "jobInputId" TEXT;

-- Add jobStatusId column to link (nullable initially)
ALTER TABLE "link" ADD COLUMN "jobStatusId" TEXT;

-- ============================================================================
-- STEP 8: Update Blob references from jobEventId
-- For first event: Set both jobStatusId (from JobStatus) and jobInputId (from JobInput)
-- For other events: Set only jobStatusId
-- ============================================================================

-- Migrate blobs from first event to both JobStatus and JobInput
UPDATE "blob" b
SET 
    "jobStatusId" = m.job_status_id,
    "jobInputId" = m.job_input_id
FROM "_job_event_migration_mapping" m
WHERE m.job_event_id = b."jobEventId"
  AND m.is_first_event = true
  AND m.job_input_id IS NOT NULL;

-- Migrate blobs from other events to JobStatus only
UPDATE "blob" b
SET "jobStatusId" = m.job_status_id
FROM "_job_event_migration_mapping" m
WHERE m.job_event_id = b."jobEventId"
  AND m.is_first_event = false;

-- Verify all blobs have been migrated
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "blob" b
        INNER JOIN "_job_event_migration_mapping" m ON m.job_event_id = b."jobEventId"
        WHERE (m.is_first_event = true AND (b."jobStatusId" IS NULL OR b."jobInputId" IS NULL))
           OR (m.is_first_event = false AND b."jobStatusId" IS NULL)
    ) THEN
        RAISE EXCEPTION 'Migration failed: Found blob records that were not properly migrated';
    END IF;
END $$;

-- ============================================================================
-- STEP 9: Update Link references from jobEventId to jobStatusId
-- ============================================================================
UPDATE "link" l
SET "jobStatusId" = m.job_status_id
FROM "_job_event_migration_mapping" m
WHERE m.job_event_id = l."jobEventId";

-- Verify all links have been migrated
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "link" WHERE "jobStatusId" IS NULL AND "jobEventId" IS NOT NULL) THEN
        RAISE EXCEPTION 'Migration failed: Found link records without jobStatusId';
    END IF;
END $$;

-- ============================================================================
-- STEP 10: Add foreign key constraints and indexes
-- Note: Both jobStatusId and jobInputId are nullable (can be null)
-- ============================================================================

-- Add foreign key constraints
ALTER TABLE "blob" ADD CONSTRAINT "blob_jobStatusId_fkey"
    FOREIGN KEY ("jobStatusId") REFERENCES "jobStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "blob" ADD CONSTRAINT "blob_jobInputId_fkey"
    FOREIGN KEY ("jobInputId") REFERENCES "JobInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "link" ADD CONSTRAINT "link_jobStatusId_fkey"
    FOREIGN KEY ("jobStatusId") REFERENCES "jobStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Make jobStatusId NOT NULL for link (link always needs jobStatusId)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "link") THEN
        ALTER TABLE "link" ALTER COLUMN "jobStatusId" SET NOT NULL;
    END IF;
END $$;

-- Add unique constraints for deduplication
CREATE UNIQUE INDEX "blob_jobStatusId_sourceUrl_key" ON "blob"("jobStatusId", "sourceUrl") WHERE "jobStatusId" IS NOT NULL;
CREATE UNIQUE INDEX "blob_jobInputId_sourceUrl_key" ON "blob"("jobInputId", "sourceUrl") WHERE "jobInputId" IS NOT NULL;
CREATE UNIQUE INDEX "link_jobStatusId_url_key" ON "link"("jobStatusId", "url");

-- Add performance indexes
CREATE INDEX "blob_jobStatusId_origin_idx" ON "blob"("jobStatusId", "origin") WHERE "jobStatusId" IS NOT NULL;
CREATE INDEX "blob_jobInputId_origin_idx" ON "blob"("jobInputId", "origin") WHERE "jobInputId" IS NOT NULL;
CREATE INDEX "link_jobStatusId_idx" ON "link"("jobStatusId");

-- ============================================================================
-- STEP 11: Remove jobEventId columns and constraints from Blob and Link
-- ============================================================================

-- Drop foreign key constraints
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_jobEventId_fkey";
ALTER TABLE "link" DROP CONSTRAINT IF EXISTS "link_jobEventId_fkey";

-- Drop indexes related to jobEventId
DROP INDEX IF EXISTS "blob_jobEventId_sourceUrl_key";
DROP INDEX IF EXISTS "blob_jobEventId_origin_idx";
DROP INDEX IF EXISTS "link_jobEventId_url_key";
DROP INDEX IF EXISTS "link_jobEventId_idx";

-- Drop jobEventId columns
ALTER TABLE "blob" DROP COLUMN "jobEventId";
ALTER TABLE "link" DROP COLUMN "jobEventId";

-- ============================================================================
-- STEP 12: Drop JobEvent table and cleanup
-- ============================================================================

-- Drop JobEvent foreign key
ALTER TABLE "jobEvent" DROP CONSTRAINT IF EXISTS "jobEvent_jobId_fkey";

-- Drop JobEvent indexes
DROP INDEX IF EXISTS "jobEvent_externalId_idx";
DROP INDEX IF EXISTS "jobEvent_jobId_idx";

-- Drop JobEvent table
DROP TABLE "jobEvent";

-- Drop migration mapping table
DROP TABLE "_job_event_migration_mapping";
