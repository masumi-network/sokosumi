-- Cancellation becomes a request rather than a terminal status, and a
-- reconcile that never reached the provider stops looking like a failed job.
--
-- Additive only. A second migration rather than an amendment of
-- 20260925001732, because that one has already been applied to preview
-- databases and editing an applied migration fails its checksum (P3009).

-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "lastPollError" TEXT,
ADD COLUMN     "pollFailures" INTEGER NOT NULL DEFAULT 0;
