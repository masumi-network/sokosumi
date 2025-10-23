-- Drop existing indexes if they exist
DROP INDEX IF EXISTS "share_jobid_public_unique_idx";
DROP INDEX IF EXISTS "share_jobid_recipientorgid_restricted_unique_idx";

-- Create a unique partial index for public shares (where recipientOrganizationId IS NULL)
-- This ensures only one public share per job
CREATE UNIQUE INDEX "share_jobid_public_unique_idx" ON "share"("jobId")
WHERE "recipientOrganizationId" IS NULL;

-- Create a unique index for restricted shares (where recipientOrganizationId IS NOT NULL)
-- This ensures only one share per job per organization
CREATE UNIQUE INDEX "share_jobid_recipientorgid_restricted_unique_idx" ON "share"("jobId", "recipientOrganizationId")
WHERE "recipientOrganizationId" IS NOT NULL;

-- Add check constraint to ensure accessType is PUBLIC when recipientOrganizationId is NULL
-- and RESTRICTED when recipientOrganizationId is NOT NULL
ALTER TABLE "share" ADD CONSTRAINT "share_accesstype_consistency_check"
CHECK (
  ("recipientOrganizationId" IS NULL AND "accessType" = 'PUBLIC') OR
  ("recipientOrganizationId" IS NOT NULL AND "accessType" = 'RESTRICTED')
);