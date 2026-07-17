-- CreateTable
CREATE TABLE "orchestrator" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "caption" TEXT,
    "description" TEXT,

    CONSTRAINT "orchestrator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestrator_api_key" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyStart" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "orchestratorId" UUID NOT NULL,

    CONSTRAINT "orchestrator_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestrator_usage" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceId" TEXT,
    "orchestratorId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "cents" BIGINT NOT NULL,
    "transactionId" TEXT NOT NULL,

    CONSTRAINT "orchestrator_usage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "task" ADD COLUMN "orchestratorId" UUID;

-- AlterTable
ALTER TABLE "taskEvent" ADD COLUMN "orchestratorId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_slug_key" ON "orchestrator"("slug");

-- CreateIndex
CREATE INDEX "orchestrator_archivedAt_idx" ON "orchestrator"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_api_key_keyHash_key" ON "orchestrator_api_key"("keyHash");

-- CreateIndex
CREATE INDEX "orchestrator_api_key_orchestratorId_idx" ON "orchestrator_api_key"("orchestratorId");

-- CreateIndex
CREATE INDEX "orchestrator_api_key_revokedAt_expiresAt_idx" ON "orchestrator_api_key"("revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_usage_transactionId_key" ON "orchestrator_usage"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_usage_orchestratorId_idempotencyKey_key" ON "orchestrator_usage"("orchestratorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "orchestrator_usage_userId_organizationId_createdAt_idx" ON "orchestrator_usage"("userId", "organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "task_orchestratorId_idx" ON "task"("orchestratorId");

-- CreateIndex
CREATE INDEX "taskEvent_orchestratorId_idx" ON "taskEvent"("orchestratorId");

-- AddForeignKey
ALTER TABLE "orchestrator_api_key" ADD CONSTRAINT "orchestrator_api_key_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_usage" ADD CONSTRAINT "orchestrator_usage_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- One-shot data migration: Hermes coworker (slug = hermes) → orchestrator
-- Runs once with this migration. Fail loud on invariant breaks.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  hermes_count INTEGER;
  hermes_coworker_id TEXT;
  hermes_name TEXT;
  hermes_caption TEXT;
  hermes_description TEXT;
  new_orchestrator_id UUID;
  assigned_task_count INTEGER;
  history_assignee_count INTEGER;
  leftover_usage_count INTEGER;
  leftover_event_count INTEGER;
  leftover_task_assignee_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO hermes_count FROM "coworker" WHERE slug = 'hermes';

  IF hermes_count = 0 THEN
    RAISE NOTICE 'No coworker with slug=hermes; skipping Hermes→orchestrator data migration';
    RETURN;
  END IF;

  IF hermes_count > 1 THEN
    RAISE EXCEPTION 'Expected at most one coworker with slug=hermes, found %', hermes_count;
  END IF;

  SELECT id, name, caption, description
  INTO hermes_coworker_id, hermes_name, hermes_caption, hermes_description
  FROM "coworker"
  WHERE slug = 'hermes';

  -- Invariant: Hermes coworker must never be a task assignee
  SELECT COUNT(*) INTO assigned_task_count
  FROM "task"
  WHERE "coworkerId" = hermes_coworker_id;

  IF assigned_task_count > 0 THEN
    RAISE EXCEPTION
      'Cannot migrate Hermes coworker %: % task(s) still have coworkerId=hermes (assignee invariant)',
      hermes_coworker_id, assigned_task_count;
  END IF;

  SELECT COUNT(*) INTO history_assignee_count
  FROM "history"
  WHERE "coworkerId" = hermes_coworker_id;

  IF history_assignee_count > 0 THEN
    RAISE EXCEPTION
      'Cannot migrate Hermes coworker %: % history row(s) still have coworkerId=hermes (assignee invariant)',
      hermes_coworker_id, history_assignee_count;
  END IF;

  new_orchestrator_id := gen_random_uuid();

  INSERT INTO "orchestrator" (
    "id",
    "createdAt",
    "updatedAt",
    "archivedAt",
    "slug",
    "name",
    "caption",
    "description"
  )
  VALUES (
    new_orchestrator_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    NULL,
    'hermes',
    hermes_name,
    hermes_caption,
    hermes_description
  );

  -- Move task events attributed to Hermes coworker → orchestrator
  UPDATE "taskEvent"
  SET
    "orchestratorId" = new_orchestrator_id,
    "coworkerId" = NULL
  WHERE "coworkerId" = hermes_coworker_id;

  -- Backfill Task.orchestratorId from earliest (initiated) task event when that
  -- event was originally from Hermes (now stamped with orchestratorId).
  UPDATE "task" AS t
  SET "orchestratorId" = new_orchestrator_id
  FROM (
    SELECT DISTINCT ON (e."taskId") e."taskId", e."orchestratorId"
    FROM "taskEvent" AS e
    ORDER BY e."taskId", e."createdAt" ASC, e."id" ASC
  ) AS first_event
  WHERE t.id = first_event."taskId"
    AND first_event."orchestratorId" = new_orchestrator_id;

  -- Move coworker_usage → orchestrator_usage (new UUIDs; keep transaction + idempotency)
  INSERT INTO "orchestrator_usage" (
    "id",
    "createdAt",
    "updatedAt",
    "idempotencyKey",
    "referenceId",
    "orchestratorId",
    "userId",
    "organizationId",
    "cents",
    "transactionId"
  )
  SELECT
    gen_random_uuid(),
    cu."createdAt",
    cu."updatedAt",
    cu."idempotencyKey",
    cu."referenceId",
    new_orchestrator_id,
    cu."userId",
    cu."organizationId",
    cu."cents",
    cu."transactionId"
  FROM "coworker_usage" AS cu
  WHERE cu."coworkerId" = hermes_coworker_id;

  DELETE FROM "coworker_usage"
  WHERE "coworkerId" = hermes_coworker_id;

  -- Drop API keys with the coworker (cascade would also do this; explicit for clarity)
  DELETE FROM "coworker_api_key"
  WHERE "coworkerId" = hermes_coworker_id;

  -- Final FK safety check before hard-delete
  SELECT COUNT(*) INTO leftover_usage_count
  FROM "coworker_usage"
  WHERE "coworkerId" = hermes_coworker_id;

  SELECT COUNT(*) INTO leftover_event_count
  FROM "taskEvent"
  WHERE "coworkerId" = hermes_coworker_id;

  SELECT COUNT(*) INTO leftover_task_assignee_count
  FROM "task"
  WHERE "coworkerId" = hermes_coworker_id;

  IF leftover_usage_count > 0 OR leftover_event_count > 0 OR leftover_task_assignee_count > 0 THEN
    RAISE EXCEPTION
      'Cannot hard-delete Hermes coworker %: leftover refs usage=% events=% tasks=%',
      hermes_coworker_id, leftover_usage_count, leftover_event_count, leftover_task_assignee_count;
  END IF;

  DELETE FROM "coworker"
  WHERE id = hermes_coworker_id;
END $$;
