-- Remove obsolete private/org-only share rows now that JobShare is public-only.
DELETE FROM "jobShare"
WHERE "token" IS NULL;

-- Drop organization-scoped sharing from JobShare.
DROP INDEX "jobShare_organizationId_idx";

ALTER TABLE "jobShare"
DROP CONSTRAINT "jobShare_organizationId_fkey";

ALTER TABLE "jobShare"
DROP COLUMN "organizationId";
