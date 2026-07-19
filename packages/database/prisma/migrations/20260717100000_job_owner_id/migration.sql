-- Rename Job.userId to ownerId. History sync must be paused during rename:
-- upsert_history_job still reads userId until recreated below.

DROP TRIGGER IF EXISTS history_job_sync ON "Job";

ALTER TABLE "Job" DROP CONSTRAINT "Job_userId_fkey";

DROP INDEX IF EXISTS "Job_userId_idx";

ALTER TABLE "Job" RENAME COLUMN "userId" TO "ownerId";

ALTER TABLE "Job" ADD CONSTRAINT "Job_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Job_ownerId_idx" ON "Job"("ownerId");

CREATE OR REPLACE FUNCTION upsert_history_job(job_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_job RECORD;
BEGIN
  SELECT j.*, a."name" AS "agentName"
  INTO source_job
  FROM "Job" AS j
  LEFT JOIN "Agent" AS a ON a."id" = j."agentId"
  WHERE j."id" = job_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'JOB'::"HistoryKind"
      AND "entityId" = job_id;
    RETURN;
  END IF;

  INSERT INTO "history" (
    "id",
    "kind",
    "entityId",
    "userId",
    "workspaceId",
    "organizationId",
    "title",
    "description",
    "status",
    "sortAt",
    "amount",
    "projectId",
    "agentId",
    "coworkerId",
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'JOB'::"HistoryKind",
    source_job."id",
    source_job."ownerId",
    source_job."workspaceId",
    source_job."organizationId",
    COALESCE(source_job."name", source_job."agentName", 'Untitled job'),
    NULL,
    compute_history_job_status(source_job."id"),
    source_job."updatedAt",
    history_job_amount(source_job."id"),
    source_job."projectId",
    source_job."agentId",
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT ("kind", "entityId") DO UPDATE
  SET
    "userId" = EXCLUDED."userId",
    "workspaceId" = EXCLUDED."workspaceId",
    "organizationId" = EXCLUDED."organizationId",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "status" = EXCLUDED."status",
    "sortAt" = EXCLUDED."sortAt",
    "amount" = EXCLUDED."amount",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

CREATE TRIGGER history_job_sync
  AFTER INSERT OR UPDATE OR DELETE ON "Job"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_job();
