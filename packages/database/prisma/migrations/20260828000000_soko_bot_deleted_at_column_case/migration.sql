-- The `orchestrator` table maps only its name; its columns stay camelCase
-- (`archivedAt`, `lastPolledAt`, …). The previous migration added `deleted_at`,
-- so Prisma queried a `deletedAt` column that did not exist and every Soko Bot
-- read failed. Corrected here rather than by editing the applied migration,
-- which would change its checksum and wedge `migrate deploy`.
ALTER TABLE "orchestrator" RENAME COLUMN "deleted_at" TO "deletedAt";

-- Postgres rewrites the predicate on rename; recreated so the live-row index is
-- explicit in the history rather than implied.
DROP INDEX IF EXISTS "orchestrator_user_workspace_live_key";

CREATE UNIQUE INDEX "orchestrator_user_workspace_live_key"
  ON "orchestrator" ("userId", "workspaceId")
  WHERE "deletedAt" IS NULL;
