-- Reordered after main's migration prefix. Fresh installs run the original DDL.
-- A branch preview may already have applied the former name. Recognize only its
-- exact successful checksum; never rewrite migration history or replay its DDL
-- over later feature migrations (which may have removed indexes).
DO $soko_migration$
BEGIN
  -- Prisma shadow replay has no migration history table.
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260926203732_soko_bot_reliability') THEN
      IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260926203732_soko_bot_reliability'
          AND checksum = '2eee4e375f18022ae78163476af20b5dcc5dbf0dd83abc1b519a109e89001e4a'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260926203732_soko_bot_reliability'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL
          AND checksum <> '2eee4e375f18022ae78163476af20b5dcc5dbf0dd83abc1b519a109e89001e4a'
      ) THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'Former migration 20260926203732_soko_bot_reliability is not an exact successful application; reconcile without changing its history';
    END IF;
  END IF;

/*
  Warnings:

  - A unique constraint covering the columns `[operationKey]` on the table `soko_bot_tool_call` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SokoBotActionDisposition" AS ENUM ('APPLIED', 'ALREADY_SATISFIED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SokoBotActionVerification" AS ENUM ('LOCAL_TRANSACTION', 'PROVIDER_ACK', 'READ_BACK', 'NONE');

-- CreateEnum
CREATE TYPE "SokoBotFulfillmentState" AS ENUM ('UNKNOWN', 'IN_PROGRESS', 'FULFILLED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SokoBotDeliveryStatus" AS ENUM ('PENDING', 'PERSISTED', 'PUBLISHED', 'SUPPRESSED', 'BLOCKED', 'DEAD_LETTER');

-- Existing custom partial uniqueness indexes are intentionally preserved.

-- AlterTable
ALTER TABLE "soko_bot_delegation" ADD COLUMN     "lastSeenEventId" TEXT;

-- AlterTable
ALTER TABLE "soko_bot_nudge" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "escalationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "lastDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "lastDeliveryId" UUID,
ADD COLUMN     "nextCheckAt" TIMESTAMP(3),
ADD COLUMN     "pendingTurnId" UUID,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "snoozedUntil" TIMESTAMP(3),
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "soko_bot_pending_decision" ADD COLUMN     "intentId" UUID;

-- AlterTable
ALTER TABLE "soko_bot_task_watch" ADD COLUMN     "lastSeenEventId" TEXT;

-- AlterTable
ALTER TABLE "soko_bot_tool_call" ADD COLUMN     "actorBotId" UUID,
ADD COLUMN     "committedAt" TIMESTAMP(3),
ADD COLUMN     "disposition" "SokoBotActionDisposition",
ADD COLUMN     "effectEventId" TEXT,
ADD COLUMN     "observedVersion" TEXT,
ADD COLUMN     "operationKey" TEXT,
ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "verification" "SokoBotActionVerification" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "soko_bot_turn" ADD COLUMN     "destinationAudience" JSONB,
ADD COLUMN     "destinationRoomId" UUID,
ADD COLUMN     "fulfillmentState" "SokoBotFulfillmentState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "intentId" UUID,
ADD COLUMN     "intentRevision" INTEGER,
ADD COLUMN     "responseContract" JSONB;

-- CreateTable
CREATE TABLE "soko_bot_delivery" (
    "id" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "destinationKind" TEXT NOT NULL DEFAULT 'CHAT_ROOM',
    "destinationId" TEXT NOT NULL DEFAULT 'NONE',
    "purpose" TEXT NOT NULL DEFAULT 'FINAL',
    "roomId" UUID,
    "messageId" UUID,
    "status" "SokoBotDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "lastErrorCategory" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "soko_bot_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soko_bot_intent" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "roomId" UUID,
    "requesterId" TEXT NOT NULL,
    "parentIntentId" UUID,
    "originatingTurnId" UUID NOT NULL,
    "desiredOutcome" TEXT NOT NULL,
    "targetIds" JSONB NOT NULL,
    "allowedActions" JSONB NOT NULL,
    "acceptanceCriteria" JSONB NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soko_bot_intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soko_bot_intent_outcome" (
    "id" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "intentRevision" INTEGER NOT NULL,
    "evidenceRevision" TEXT NOT NULL,
    "state" "SokoBotFulfillmentState" NOT NULL DEFAULT 'UNKNOWN',
    "criteriaResults" JSONB NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "remainingSteps" JSONB NOT NULL,
    "blockerKind" TEXT,
    "verifierVersion" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soko_bot_intent_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soko_bot_event_inbox" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "botId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "turnId" UUID NOT NULL,
    "designatedHandlerBotId" UUID,

    CONSTRAINT "soko_bot_event_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soko_bot_task_action_claim" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "triggeringEventId" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "handlerBotId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "receiptId" UUID,
    "fencingToken" INTEGER NOT NULL DEFAULT 1,
    "leaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "soko_bot_task_action_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_delivery_turnId_key" ON "soko_bot_delivery"("turnId");

-- CreateIndex
CREATE INDEX "soko_bot_delivery_status_nextAttemptAt_idx" ON "soko_bot_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_delivery_turnId_destinationKind_destinationId_purp_key" ON "soko_bot_delivery"("turnId", "destinationKind", "destinationId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_intent_originatingTurnId_key" ON "soko_bot_intent"("originatingTurnId");

-- CreateIndex
CREATE INDEX "soko_bot_intent_sokoBotId_workspaceId_roomId_requesterId_st_idx" ON "soko_bot_intent"("sokoBotId", "workspaceId", "roomId", "requesterId", "state");

-- CreateIndex
CREATE INDEX "soko_bot_intent_outcome_intentId_assessedAt_idx" ON "soko_bot_intent_outcome"("intentId", "assessedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_intent_outcome_intentId_intentRevision_evidenceRev_key" ON "soko_bot_intent_outcome"("intentId", "intentRevision", "evidenceRevision");

-- CreateIndex
CREATE INDEX "soko_bot_event_inbox_turnId_entityId_idx" ON "soko_bot_event_inbox"("turnId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_event_inbox_botId_eventId_purpose_key" ON "soko_bot_event_inbox"("botId", "eventId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_task_action_claim_taskId_triggeringEventId_actionK_key" ON "soko_bot_task_action_claim"("taskId", "triggeringEventId", "actionKind");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_tool_call_operationKey_key" ON "soko_bot_tool_call"("operationKey");

-- AddForeignKey
ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "soko_bot_intent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_delivery" ADD CONSTRAINT "soko_bot_delivery_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_intent" ADD CONSTRAINT "soko_bot_intent_originatingTurnId_fkey" FOREIGN KEY ("originatingTurnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_intent_outcome" ADD CONSTRAINT "soko_bot_intent_outcome_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "soko_bot_intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_pending_decision" ADD CONSTRAINT "soko_bot_pending_decision_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "soko_bot_intent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

END
$soko_migration$;
