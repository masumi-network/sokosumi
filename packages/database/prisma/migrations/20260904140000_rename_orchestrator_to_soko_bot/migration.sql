-- SOK-946: rename physical orchestrator* tables/columns/indexes to soko_bot*.
-- Data-preserving RENAME only. Actor type "orchestrator" is unchanged.

-- Tables
ALTER TABLE "orchestrator" RENAME TO "soko_bot";
ALTER TABLE "orchestrator_usage" RENAME TO "soko_bot_usage";
ALTER TABLE "chat_room_orchestrator_member" RENAME TO "chat_room_soko_bot_member";

-- Columns
ALTER TABLE "soko_bot_usage" RENAME COLUMN "orchestratorId" TO "sokoBotId";
ALTER TABLE "chat_room_soko_bot_member" RENAME COLUMN "orchestratorId" TO "sokoBotId";
ALTER TABLE "chat_room_message" RENAME COLUMN "senderOrchestratorId" TO "senderSokoBotId";
ALTER TABLE "chat_room_mention" RENAME COLUMN "orchestratorId" TO "sokoBotId";
ALTER TABLE "task" RENAME COLUMN "assigneeOrchestratorId" TO "assigneeSokoBotId";
ALTER TABLE "task" RENAME COLUMN "creatorOrchestratorId" TO "creatorSokoBotId";
ALTER TABLE "task_file" RENAME COLUMN "uploadedByOrchestratorId" TO "uploadedBySokoBotId";
ALTER TABLE "taskEvent" RENAME COLUMN "orchestratorId" TO "sokoBotId";
ALTER TABLE "history" RENAME COLUMN "orchestratorId" TO "sokoBotId";
ALTER TABLE "coworker_api_key" RENAME COLUMN "orchestratorId" TO "sokoBotId";

-- soko_bot table constraints / indexes
ALTER TABLE "soko_bot" RENAME CONSTRAINT "orchestrator_pkey" TO "soko_bot_pkey";
ALTER TABLE "soko_bot" RENAME CONSTRAINT "orchestrator_userId_fkey" TO "soko_bot_userId_fkey";
ALTER TABLE "soko_bot" RENAME CONSTRAINT "orchestrator_workspaceId_fkey" TO "soko_bot_workspaceId_fkey";
ALTER INDEX "orchestrator_eveSessionId_key" RENAME TO "soko_bot_eveSessionId_key";
ALTER INDEX "orchestrator_archivedAt_idx" RENAME TO "soko_bot_archivedAt_idx";
ALTER INDEX "orchestrator_lastPolledAt_idx" RENAME TO "soko_bot_lastPolledAt_idx";
ALTER INDEX "orchestrator_userId_workspaceId_idx" RENAME TO "soko_bot_userId_workspaceId_idx";
ALTER INDEX "orchestrator_workspaceId_idx" RENAME TO "soko_bot_workspaceId_idx";
ALTER INDEX "orchestrator_user_workspace_live_key" RENAME TO "soko_bot_user_workspace_live_key";

-- Recreate the live unique so the final CREATE in migration history names
-- soko_bot (schema tests read concatenated SQL for the last live-key CREATE).
DROP INDEX IF EXISTS "soko_bot_user_workspace_live_key";
CREATE UNIQUE INDEX "soko_bot_user_workspace_live_key"
  ON "soko_bot" ("userId", "workspaceId")
  WHERE "deletedAt" IS NULL;

-- soko_bot_usage
ALTER TABLE "soko_bot_usage" RENAME CONSTRAINT "orchestrator_usage_pkey" TO "soko_bot_usage_pkey";
ALTER INDEX "orchestrator_usage_transactionId_key" RENAME TO "soko_bot_usage_transactionId_key";
ALTER INDEX "orchestrator_usage_orchestratorId_idempotencyKey_key" RENAME TO "soko_bot_usage_sokoBotId_idempotencyKey_key";
ALTER INDEX "orchestrator_usage_userId_organizationId_createdAt_idx" RENAME TO "soko_bot_usage_userId_organizationId_createdAt_idx";
ALTER TABLE "soko_bot_usage" RENAME CONSTRAINT "orchestrator_usage_orchestratorId_fkey" TO "soko_bot_usage_sokoBotId_fkey";
ALTER TABLE "soko_bot_usage" RENAME CONSTRAINT "orchestrator_usage_userId_fkey" TO "soko_bot_usage_userId_fkey";
ALTER TABLE "soko_bot_usage" RENAME CONSTRAINT "orchestrator_usage_organizationId_fkey" TO "soko_bot_usage_organizationId_fkey";
ALTER TABLE "soko_bot_usage" RENAME CONSTRAINT "orchestrator_usage_transactionId_fkey" TO "soko_bot_usage_transactionId_fkey";

-- chat_room_soko_bot_member
ALTER TABLE "chat_room_soko_bot_member" RENAME CONSTRAINT "chat_room_orchestrator_member_pkey" TO "chat_room_soko_bot_member_pkey";
ALTER INDEX "chat_room_orchestrator_member_roomId_orchestratorId_key" RENAME TO "chat_room_soko_bot_member_roomId_sokoBotId_key";
ALTER INDEX "chat_room_orchestrator_member_orchestratorId_idx" RENAME TO "chat_room_soko_bot_member_sokoBotId_idx";
ALTER TABLE "chat_room_soko_bot_member" RENAME CONSTRAINT "chat_room_orchestrator_member_roomId_fkey" TO "chat_room_soko_bot_member_roomId_fkey";
ALTER TABLE "chat_room_soko_bot_member" RENAME CONSTRAINT "chat_room_orchestrator_member_orchestratorId_fkey" TO "chat_room_soko_bot_member_sokoBotId_fkey";

-- Other FK / index names
ALTER INDEX "chat_room_message_senderOrchestratorId_idx" RENAME TO "chat_room_message_senderSokoBotId_idx";
ALTER TABLE "chat_room_message" RENAME CONSTRAINT "chat_room_message_senderOrchestratorId_fkey" TO "chat_room_message_senderSokoBotId_fkey";
ALTER INDEX "chat_room_mention_messageId_orchestratorId_key" RENAME TO "chat_room_mention_messageId_sokoBotId_key";
ALTER INDEX "chat_room_mention_orchestratorId_status_idx" RENAME TO "chat_room_mention_sokoBotId_status_idx";
ALTER TABLE "chat_room_mention" RENAME CONSTRAINT "chat_room_mention_orchestratorId_fkey" TO "chat_room_mention_sokoBotId_fkey";
ALTER INDEX "task_assigneeOrchestratorId_idx" RENAME TO "task_assigneeSokoBotId_idx";
ALTER TABLE "task" RENAME CONSTRAINT "task_assigneeOrchestratorId_fkey" TO "task_assigneeSokoBotId_fkey";
ALTER INDEX "task_creatorOrchestratorId_idx" RENAME TO "task_creatorSokoBotId_idx";
ALTER TABLE "task" RENAME CONSTRAINT "task_creatorOrchestratorId_fkey" TO "task_creatorSokoBotId_fkey";
ALTER INDEX "task_file_uploadedByOrchestratorId_idx" RENAME TO "task_file_uploadedBySokoBotId_idx";
ALTER TABLE "task_file" RENAME CONSTRAINT "task_file_uploadedByOrchestratorId_fkey" TO "task_file_uploadedBySokoBotId_fkey";
ALTER INDEX "taskEvent_orchestratorId_idx" RENAME TO "taskEvent_sokoBotId_idx";
ALTER TABLE "taskEvent" RENAME CONSTRAINT "taskEvent_orchestratorId_fkey" TO "taskEvent_sokoBotId_fkey";
ALTER INDEX "history_orchestratorId_idx" RENAME TO "history_sokoBotId_idx";
ALTER INDEX "coworker_api_key_orchestratorId_idx" RENAME TO "coworker_api_key_sokoBotId_idx";
ALTER TABLE "coworker_api_key" RENAME CONSTRAINT "coworker_api_key_orchestratorId_fkey" TO "coworker_api_key_sokoBotId_fkey";

-- History trigger body still names the old columns as text.
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
    "sokoBotId",
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
    source_task."assigneeSokoBotId",
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
    "sokoBotId" = EXCLUDED."sokoBotId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;
