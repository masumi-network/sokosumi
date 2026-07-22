-- Per-user Orchestrator: fold hermesInstance into orchestrator, drop product
-- profile fields and orchestrator_api_key. Auth becomes an env service token.

-- 1) Add instance columns (nullable until backfill)
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "avatarSeed" TEXT;
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "personalityTone" INTEGER;
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "personalityDetail" INTEGER;
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "personalityStyle" INTEGER;
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "lastPolledAt" TIMESTAMP(3);
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "lastInboxMessageAt" TIMESTAMP(3);
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "lastSeenInboxAt" TIMESTAMP(3);
ALTER TABLE "orchestrator" ADD COLUMN IF NOT EXISTS "consecutivePollErrors" INTEGER NOT NULL DEFAULT 0;

-- Allow product-era columns to accept per-user backfill rows
ALTER TABLE "orchestrator" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "orchestrator" ALTER COLUMN "slug" DROP NOT NULL;

-- Drop product uniqueness temporarily so we can insert per-user rows
DROP INDEX IF EXISTS "orchestrator_slug_key";

-- 2) Backfill one orchestrator per hermesInstance (new UUIDs)
INSERT INTO "orchestrator" (
  "id",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "slug",
  "name",
  "caption",
  "description",
  "image",
  "userId",
  "avatarSeed",
  "personalityTone",
  "personalityDetail",
  "personalityStyle",
  "lastPolledAt",
  "lastInboxMessageAt",
  "lastSeenInboxAt",
  "consecutivePollErrors"
)
SELECT
  gen_random_uuid(),
  hi."createdAt",
  hi."updatedAt",
  NULL,
  NULL,
  hi."assistantName",
  NULL,
  NULL,
  NULL,
  hi."userId",
  hi."avatarSeed",
  hi."personalityTone",
  hi."personalityDetail",
  hi."personalityStyle",
  hi."lastPolledAt",
  hi."lastInboxMessageAt",
  hi."lastSeenInboxAt",
  hi."consecutivePollErrors"
FROM "hermesInstance" hi
WHERE NOT EXISTS (
  SELECT 1 FROM "orchestrator" o WHERE o."userId" = hi."userId"
);

-- 3) Stub orchestrators for users with usage/tasks/events but no hermesInstance row
-- Stubs are archived: they exist only for historical FK remap, not live instances.
-- Event remap joins via task.ownerId (orchestrator events usually set userId null),
-- so stub owners of tasks that still have events on a global product orchestrator —
-- including after purge deleted hermesInstance.
INSERT INTO "orchestrator" (
  "id", "createdAt", "updatedAt", "archivedAt", "slug", "name", "userId", "consecutivePollErrors"
)
SELECT gen_random_uuid(), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, u."userId", 0
FROM (
  SELECT DISTINCT ou."userId" AS "userId" FROM "orchestrator_usage" ou
  UNION
  SELECT DISTINCT t."ownerId" AS "userId" FROM "task" t
    WHERE t."creatorOrchestratorId" IS NOT NULL
  UNION
  -- Dual-FK historical rows (if any)
  SELECT DISTINCT te."userId" AS "userId" FROM "taskEvent" te
    WHERE te."orchestratorId" IS NOT NULL AND te."userId" IS NOT NULL
  UNION
  -- Dual of event remap: owners of tasks with events still on a global orchestrator
  SELECT DISTINCT t."ownerId" AS "userId"
  FROM "task" t
  JOIN "taskEvent" te ON te."taskId" = t."id"
  WHERE te."orchestratorId" IS NOT NULL
    AND te."orchestratorId" IN (
      SELECT id FROM "orchestrator" WHERE "userId" IS NULL
    )
) u
WHERE u."userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "orchestrator" o WHERE o."userId" = u."userId");

-- 4) Remap FKs from global (userId IS NULL) orchestrators to per-user rows
UPDATE "task" t
SET "creatorOrchestratorId" = o."id"
FROM "orchestrator" o
WHERE o."userId" = t."ownerId"
  AND t."creatorOrchestratorId" IS NOT NULL
  AND t."creatorOrchestratorId" IN (
    SELECT id FROM "orchestrator" WHERE "userId" IS NULL
  );

UPDATE "taskEvent" te
SET "orchestratorId" = o."id"
FROM "task" t
JOIN "orchestrator" o ON o."userId" = t."ownerId"
WHERE te."taskId" = t."id"
  AND te."orchestratorId" IS NOT NULL
  AND te."orchestratorId" IN (
    SELECT id FROM "orchestrator" WHERE "userId" IS NULL
  );

UPDATE "orchestrator_usage" ou
SET "orchestratorId" = o."id"
FROM "orchestrator" o
WHERE o."userId" = ou."userId"
  AND ou."orchestratorId" IN (
    SELECT id FROM "orchestrator" WHERE "userId" IS NULL
  );

-- Fail loudly if anything still references a global product orchestrator
DO $$
DECLARE
  leftover_tasks INTEGER;
  leftover_events INTEGER;
  leftover_usage INTEGER;
BEGIN
  SELECT COUNT(*) INTO leftover_tasks FROM "task"
    WHERE "creatorOrchestratorId" IN (SELECT id FROM "orchestrator" WHERE "userId" IS NULL);
  SELECT COUNT(*) INTO leftover_events FROM "taskEvent"
    WHERE "orchestratorId" IN (SELECT id FROM "orchestrator" WHERE "userId" IS NULL);
  SELECT COUNT(*) INTO leftover_usage FROM "orchestrator_usage"
    WHERE "orchestratorId" IN (SELECT id FROM "orchestrator" WHERE "userId" IS NULL);
  IF leftover_tasks > 0 OR leftover_events > 0 OR leftover_usage > 0 THEN
    RAISE EXCEPTION
      'per_user_orchestrator migration: unmapped FKs remain (tasks=%, events=%, usage=%)',
      leftover_tasks, leftover_events, leftover_usage;
  END IF;
END $$;

-- 5) Drop API keys and global product orchestrator rows
DROP TABLE IF EXISTS "orchestrator_api_key";

DELETE FROM "orchestrator" WHERE "userId" IS NULL;

-- 6) Drop hermesInstance
DROP TABLE IF EXISTS "hermesInstance";

-- 7) Drop product profile columns
ALTER TABLE "orchestrator" DROP COLUMN IF EXISTS "slug";
ALTER TABLE "orchestrator" DROP COLUMN IF EXISTS "caption";
ALTER TABLE "orchestrator" DROP COLUMN IF EXISTS "description";
ALTER TABLE "orchestrator" DROP COLUMN IF EXISTS "image";

-- 8) Enforce userId required + unique
ALTER TABLE "orchestrator" ALTER COLUMN "userId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "orchestrator_userId_key" ON "orchestrator"("userId");
CREATE INDEX IF NOT EXISTS "orchestrator_lastPolledAt_idx" ON "orchestrator"("lastPolledAt");

ALTER TABLE "orchestrator"
  ADD CONSTRAINT "orchestrator_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
