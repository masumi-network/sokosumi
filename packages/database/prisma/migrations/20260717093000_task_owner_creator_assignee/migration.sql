-- Rename task owner / assignee columns and introduce polymorphic creator FKs.
-- History sync must be paused during renames: the old upsert_history_task still
-- reads userId/coworkerId, and RENAME fires AFTER UPDATE triggers.

DROP TRIGGER IF EXISTS history_task_sync ON "task";

-- Drop FKs and indexes that reference columns being renamed or removed.
ALTER TABLE "task" DROP CONSTRAINT "task_userId_fkey";
ALTER TABLE "task" DROP CONSTRAINT "task_coworkerId_fkey";
ALTER TABLE "task" DROP CONSTRAINT "task_orchestratorId_fkey";

DROP INDEX IF EXISTS "task_userId_idx";
DROP INDEX IF EXISTS "task_userId_organizationId_idx";
DROP INDEX IF EXISTS "task_orchestratorId_idx";

-- Rename ownership / assignee columns.
ALTER TABLE "task" RENAME COLUMN "userId" TO "ownerId";
ALTER TABLE "task" RENAME COLUMN "coworkerId" TO "assigneeId";

-- Creator triad (exactly one set after backfill).
ALTER TABLE "task" ADD COLUMN "creatorUserId" TEXT;
ALTER TABLE "task" ADD COLUMN "creatorCoworkerId" TEXT;
ALTER TABLE "task" ADD COLUMN "creatorOrchestratorId" UUID;

-- Backfill creator from legacy orchestrator attribution, else owner as user creator.
UPDATE "task"
SET
  "creatorOrchestratorId" = "orchestratorId",
  "creatorUserId" = CASE
    WHEN "orchestratorId" IS NULL THEN "ownerId"
    ELSE NULL
  END;

ALTER TABLE "task" DROP COLUMN "orchestratorId";

ALTER TABLE "task" ADD CONSTRAINT "task_creator_exactly_one_check" CHECK (
  (
    ("creatorUserId" IS NOT NULL)::int
    + ("creatorCoworkerId" IS NOT NULL)::int
    + ("creatorOrchestratorId" IS NOT NULL)::int
  ) = 1
);

-- Recreate FKs.
ALTER TABLE "task" ADD CONSTRAINT "task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Restrict (not SET NULL): nulling a creator FK would violate task_creator_exactly_one_check.
ALTER TABLE "task" ADD CONSTRAINT "task_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_creatorCoworkerId_fkey" FOREIGN KEY ("creatorCoworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_creatorOrchestratorId_fkey" FOREIGN KEY ("creatorOrchestratorId") REFERENCES "orchestrator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes.
CREATE INDEX "task_ownerId_idx" ON "task"("ownerId");
CREATE INDEX "task_ownerId_organizationId_idx" ON "task"("ownerId", "organizationId");
CREATE INDEX "task_assigneeId_idx" ON "task"("assigneeId");
CREATE INDEX "task_creatorUserId_idx" ON "task"("creatorUserId");
CREATE INDEX "task_creatorCoworkerId_idx" ON "task"("creatorCoworkerId");
CREATE INDEX "task_creatorOrchestratorId_idx" ON "task"("creatorOrchestratorId");

-- History sync reads task owner/assignee columns.
CREATE OR REPLACE FUNCTION upsert_history_task(task_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_task "task"%ROWTYPE;
BEGIN
  SELECT *
  INTO source_task
  FROM "task"
  WHERE "id" = task_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'TASK'::"HistoryKind"
      AND "entityId" = task_id;
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
    'TASK'::"HistoryKind",
    source_task."id",
    source_task."ownerId",
    source_task."workspaceId",
    source_task."organizationId",
    source_task."name",
    source_task."description",
    source_task."status"::TEXT,
    source_task."updatedAt",
    history_task_amount(source_task."id"),
    source_task."projectId",
    NULL,
    source_task."assigneeId",
    NULL,
    source_task."archivedAt"
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

CREATE TRIGGER history_task_sync
  AFTER INSERT OR UPDATE OR DELETE ON "task"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_task();
