-- A CMO test copy (ADR 0073): a Project marked as the copy of another, and
-- its Social connections linked to the source's connected accounts.
ALTER TABLE "project" ADD COLUMN "testCopyOfProjectId" UUID,
ADD COLUMN "testCopyTornDownAt" TIMESTAMP(3);

ALTER TABLE "project_social_connection" ADD COLUMN "executorProjectId" UUID;
