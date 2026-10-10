-- AlterTable
ALTER TABLE "project_social_connection" ADD COLUMN "performanceRefreshAttemptedAt" TIMESTAMP(3);
ALTER TABLE "project_social_connection" ADD COLUMN "performanceHeadFetchedAt" TIMESTAMP(3);
ALTER TABLE "project_social_connection" ADD COLUMN "performanceRefreshRequestedAt" TIMESTAMP(3);
