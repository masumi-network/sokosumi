-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "jobCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing Job rows
UPDATE "Agent" AS agent
SET "jobCount" = job_counts.cnt
FROM (
  SELECT "agentId", COUNT(*)::integer AS cnt
  FROM "Job"
  GROUP BY "agentId"
) AS job_counts
WHERE agent.id = job_counts."agentId";

-- CreateIndex
CREATE INDEX "Agent_jobCount_createdAt_id_idx" ON "Agent"("jobCount" DESC, "createdAt" DESC, "id" DESC);
