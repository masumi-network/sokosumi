-- Additive Soko Bot control plane. Existing Hermes/Orchestrator columns remain
-- available to the previous Core release during the deploy window.

-- Inner-joining an incomplete owner mapping would silently discard history.
-- Check before any DDL because migration runners need not wrap PostgreSQL files
-- in a transaction. Operators must repair source ownership before retrying.
DO $$
DECLARE
  unmapped_message_count BIGINT;
BEGIN
  SELECT count(*)
  INTO unmapped_message_count
  FROM "hermesMessage" AS message
  LEFT JOIN "orchestrator" AS bot ON bot."userId" = message."userId"
  WHERE bot."id" IS NULL;

  IF unmapped_message_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate Hermes history: % message(s) have no Soko Bot owner mapping', unmapped_message_count
      USING
        ERRCODE = 'check_violation',
        HINT = 'Create one orchestrator mapping for every Hermes message owner before retrying migration';
  END IF;
END;
$$;

CREATE TYPE "SokoBotStatus" AS ENUM ('IDLE', 'RUNNING', 'PAUSED', 'ERROR');
CREATE TYPE "SokoBotAutonomyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "SokoBotTurnSource" AS ENUM ('CHAT', 'SCHEDULE', 'ADMIN_RETRY');
CREATE TYPE "SokoBotTurnStatus" AS ENUM ('QUEUED', 'STARTING', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "SokoBotAdminActionStatus" AS ENUM ('ATTEMPTED', 'SUCCEEDED', 'FAILED');
CREATE TYPE "SokoBotTurnRoute" AS ENUM ('DIRECT_RESPONSE', 'CLARIFY', 'DELEGATE_TASK', 'HIRE_AGENT', 'MANAGE_WORK', 'MIXED');
CREATE TYPE "SokoBotDelegationKind" AS ENUM ('TASK', 'JOB');
CREATE TYPE "SokoBotDecisionStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "SokoBotScheduleRunStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');
CREATE TYPE "SokoBotToolCallStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "orchestrator"
  ADD COLUMN "status" "SokoBotStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "adminPausedAt" TIMESTAMP(3),
  ADD COLUMN "autonomyLevel" "SokoBotAutonomyLevel" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "eveSessionId" TEXT,
  ADD COLUMN "runtimeVersion" TEXT,
  ADD COLUMN "runtimeDeployment" TEXT,
  ADD COLUMN "lastSandboxId" TEXT,
  ADD COLUMN "lastSandboxStatus" TEXT,
  ADD COLUMN "memoryVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "memoryHash" TEXT,
  ADD COLUMN "lastActivityAt" TIMESTAMP(3),
  ADD COLUMN "lastTurnAt" TIMESTAMP(3),
  ADD COLUMN "lastSucceededAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedAt" TIMESTAMP(3),
  ADD COLUMN "consecutiveTurnFailures" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "orchestrator_eveSessionId_key" ON "orchestrator"("eveSessionId");

CREATE TABLE "soko_bot_legacy_message" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "kind" TEXT,
  "stepCount" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,

  CONSTRAINT "soko_bot_legacy_message_pkey" PRIMARY KEY ("id")
);

-- Preserve user-visible Hermes history before the external writer is retired.
-- IDs remain stable, making the backfill safe to audit against the source.
INSERT INTO "soko_bot_legacy_message" (
  "id", "createdAt", "sokoBotId", "userId", "role", "content", "kind", "stepCount", "durationMs"
)
SELECT
  message."id", message."createdAt", bot."id", message."userId",
  message."role", message."content", message."kind",
  CASE
    WHEN jsonb_typeof(message."steps") = 'array'
      THEN jsonb_array_length(message."steps")
    WHEN jsonb_typeof(message."steps") = 'object'
      AND jsonb_typeof(message."steps" -> 'steps') = 'array'
      THEN jsonb_array_length(message."steps" -> 'steps')
    ELSE 0
  END,
  message."durationMs"
FROM "hermesMessage" AS message
INNER JOIN "orchestrator" AS bot ON bot."userId" = message."userId"
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX "soko_bot_legacy_message_sokoBotId_createdAt_idx" ON "soko_bot_legacy_message"("sokoBotId", "createdAt");
CREATE INDEX "soko_bot_legacy_message_userId_createdAt_idx" ON "soko_bot_legacy_message"("userId", "createdAt");

ALTER TABLE "soko_bot_legacy_message" ADD CONSTRAINT "soko_bot_legacy_message_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_legacy_message" ADD CONSTRAINT "soko_bot_legacy_message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pending Composio claims must not survive cutover. Existing connected
-- accounts are revoked through the external-provider checklist/runbook.
UPDATE "hermesPendingConnection"
SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP);

CREATE TABLE "soko_bot_turn" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "source" "SokoBotTurnSource" NOT NULL,
  "status" "SokoBotTurnStatus" NOT NULL DEFAULT 'QUEUED',
  "route" "SokoBotTurnRoute",
  "clientTurnId" TEXT NOT NULL,
  "userMessage" TEXT NOT NULL,
  "finalAnswer" TEXT,
  "classification" JSONB,
  "classifierModel" TEXT,
  "classifierVersion" TEXT,
  "classifierLatencyMs" INTEGER,
  "classificationFailed" BOOLEAN NOT NULL DEFAULT false,
  "capabilityNames" TEXT[] NOT NULL,
  "eveSessionId" TEXT,
  "eveTurnId" TEXT,
  "eveStreamIndex" INTEGER NOT NULL DEFAULT -1,
  "activeUiStreamId" TEXT,
  "continuationTokenCiphertext" TEXT,
  "continuationTokenKeyId" TEXT,
  "modelId" TEXT,
  "runtimeVersion" TEXT,
  "usage" JSONB,
  "costUsdMicros" BIGINT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "reconcilerHeartbeatAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "cancellationRequestedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "errorKind" TEXT,
  "errorDetail" TEXT,

  CONSTRAINT "soko_bot_turn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_event" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "turnId" UUID NOT NULL,
  "eveEventId" TEXT NOT NULL,
  "eveStartIndex" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "summary" TEXT,
  "payload" JSONB,
  "toolName" TEXT,
  "toolCallId" TEXT,
  "toolStatus" TEXT,
  "durationMs" INTEGER,
  "providerAt" TIMESTAMP(3),

  CONSTRAINT "soko_bot_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_tool_call" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "turnId" UUID NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "status" "SokoBotToolCallStatus" NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "errorKind" TEXT,
  "errorDetail" TEXT,

  CONSTRAINT "soko_bot_tool_call_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_context_snapshot" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "turnId" UUID NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "packet" JSONB NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "tokenEstimate" INTEGER NOT NULL,
  "counts" JSONB NOT NULL,
  "omissions" JSONB NOT NULL,

  CONSTRAINT "soko_bot_context_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_memory_revision" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sokoBotId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "markdown" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceTurnId" UUID,

  CONSTRAINT "soko_bot_memory_revision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_delegation" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "turnId" UUID NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "kind" "SokoBotDelegationKind" NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT,
  "error" TEXT,
  "taskId" TEXT,
  "jobId" TEXT,

  CONSTRAINT "soko_bot_delegation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_pending_decision" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "turnId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "toolName" TEXT NOT NULL,
  "proposal" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "SokoBotDecisionStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "resultingTurnId" UUID,
  "resultingEntityId" TEXT,

  CONSTRAINT "soko_bot_pending_decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_schedule" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "timezone" TEXT NOT NULL,
  "cronExpression" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "legacyScheduleId" TEXT,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "soko_bot_schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_schedule_run" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "scheduleId" UUID NOT NULL,
  "turnId" UUID,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "SokoBotScheduleRunStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "errorKind" TEXT,
  "errorDetail" TEXT,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "soko_bot_schedule_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soko_bot_admin_action" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operationId" TEXT NOT NULL,
  "status" "SokoBotAdminActionStatus" NOT NULL,
  "sokoBotId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "reason" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "errorKind" TEXT,
  "errorDetail" TEXT,
  "requestId" TEXT,
  "traceId" TEXT,

  CONSTRAINT "soko_bot_admin_action_pkey" PRIMARY KEY ("id")
);

-- Audit events are insert-only for normal application DML.
-- Statement-level guard also rejects zero-row mutations and bulk truncation.
CREATE OR REPLACE FUNCTION reject_soko_bot_admin_action_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'soko_bot_admin_action is append-only; % is forbidden', TG_OP
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;

DROP TRIGGER IF EXISTS soko_bot_admin_action_append_only
  ON "soko_bot_admin_action";

CREATE TRIGGER soko_bot_admin_action_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE
  ON "soko_bot_admin_action"
  FOR EACH STATEMENT
  EXECUTE FUNCTION reject_soko_bot_admin_action_mutation();

CREATE UNIQUE INDEX "soko_bot_turn_sokoBotId_clientTurnId_key" ON "soko_bot_turn"("sokoBotId", "clientTurnId");
CREATE UNIQUE INDEX "soko_bot_turn_sokoBotId_eveTurnId_key" ON "soko_bot_turn"("sokoBotId", "eveTurnId");
CREATE INDEX "soko_bot_turn_userId_createdAt_idx" ON "soko_bot_turn"("userId", "createdAt" DESC);
CREATE INDEX "soko_bot_turn_sokoBotId_status_createdAt_idx" ON "soko_bot_turn"("sokoBotId", "status", "createdAt" DESC);
CREATE INDEX "soko_bot_turn_status_reconcilerHeartbeatAt_idx" ON "soko_bot_turn"("status", "reconcilerHeartbeatAt");

CREATE UNIQUE INDEX "soko_bot_event_turnId_eveEventId_key" ON "soko_bot_event"("turnId", "eveEventId");
CREATE UNIQUE INDEX "soko_bot_event_turnId_eveStartIndex_key" ON "soko_bot_event"("turnId", "eveStartIndex");
CREATE UNIQUE INDEX "soko_bot_event_turnId_sequence_key" ON "soko_bot_event"("turnId", "sequence");
CREATE INDEX "soko_bot_event_turnId_createdAt_idx" ON "soko_bot_event"("turnId", "createdAt");

CREATE UNIQUE INDEX "soko_bot_tool_call_turnId_toolCallId_key" ON "soko_bot_tool_call"("turnId", "toolCallId");
CREATE INDEX "soko_bot_tool_call_turnId_createdAt_idx" ON "soko_bot_tool_call"("turnId", "createdAt");

CREATE UNIQUE INDEX "soko_bot_context_snapshot_turnId_key" ON "soko_bot_context_snapshot"("turnId");
CREATE INDEX "soko_bot_context_snapshot_hash_idx" ON "soko_bot_context_snapshot"("hash");

CREATE UNIQUE INDEX "soko_bot_memory_revision_sokoBotId_version_key" ON "soko_bot_memory_revision"("sokoBotId", "version");
CREATE INDEX "soko_bot_memory_revision_sokoBotId_createdAt_idx" ON "soko_bot_memory_revision"("sokoBotId", "createdAt" DESC);

CREATE UNIQUE INDEX "soko_bot_delegation_turnId_toolCallId_key" ON "soko_bot_delegation"("turnId", "toolCallId");
CREATE INDEX "soko_bot_delegation_taskId_idx" ON "soko_bot_delegation"("taskId");
CREATE INDEX "soko_bot_delegation_jobId_idx" ON "soko_bot_delegation"("jobId");

CREATE INDEX "soko_bot_pending_decision_userId_status_createdAt_idx" ON "soko_bot_pending_decision"("userId", "status", "createdAt" DESC);
CREATE INDEX "soko_bot_pending_decision_sokoBotId_status_idx" ON "soko_bot_pending_decision"("sokoBotId", "status");

CREATE INDEX "soko_bot_schedule_enabled_nextRunAt_idx" ON "soko_bot_schedule"("enabled", "nextRunAt");
CREATE INDEX "soko_bot_schedule_userId_createdAt_idx" ON "soko_bot_schedule"("userId", "createdAt" DESC);
CREATE UNIQUE INDEX "soko_bot_schedule_legacyScheduleId_key" ON "soko_bot_schedule"("legacyScheduleId");

CREATE UNIQUE INDEX "soko_bot_schedule_run_turnId_key" ON "soko_bot_schedule_run"("turnId");
CREATE UNIQUE INDEX "soko_bot_schedule_run_scheduleId_scheduledFor_key" ON "soko_bot_schedule_run"("scheduleId", "scheduledFor");
CREATE INDEX "soko_bot_schedule_run_status_scheduledFor_idx" ON "soko_bot_schedule_run"("status", "scheduledFor");

CREATE INDEX "soko_bot_admin_action_sokoBotId_createdAt_idx" ON "soko_bot_admin_action"("sokoBotId", "createdAt" DESC);
CREATE INDEX "soko_bot_admin_action_operatorId_createdAt_idx" ON "soko_bot_admin_action"("operatorId", "createdAt" DESC);
CREATE INDEX "soko_bot_admin_action_traceId_createdAt_idx" ON "soko_bot_admin_action"("traceId", "createdAt" DESC);
CREATE UNIQUE INDEX "soko_bot_admin_action_operationId_status_key" ON "soko_bot_admin_action"("operationId", "status");

ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "soko_bot_event" ADD CONSTRAINT "soko_bot_event_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_tool_call" ADD CONSTRAINT "soko_bot_tool_call_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_context_snapshot" ADD CONSTRAINT "soko_bot_context_snapshot_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_memory_revision" ADD CONSTRAINT "soko_bot_memory_revision_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_memory_revision" ADD CONSTRAINT "soko_bot_memory_revision_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "soko_bot_turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "soko_bot_delegation" ADD CONSTRAINT "soko_bot_delegation_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_delegation" ADD CONSTRAINT "soko_bot_delegation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "soko_bot_delegation" ADD CONSTRAINT "soko_bot_delegation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "soko_bot_pending_decision" ADD CONSTRAINT "soko_bot_pending_decision_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_pending_decision" ADD CONSTRAINT "soko_bot_pending_decision_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_pending_decision" ADD CONSTRAINT "soko_bot_pending_decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_pending_decision" ADD CONSTRAINT "soko_bot_pending_decision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_schedule" ADD CONSTRAINT "soko_bot_schedule_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_schedule" ADD CONSTRAINT "soko_bot_schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_schedule" ADD CONSTRAINT "soko_bot_schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_schedule_run" ADD CONSTRAINT "soko_bot_schedule_run_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "soko_bot_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_schedule_run" ADD CONSTRAINT "soko_bot_schedule_run_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
