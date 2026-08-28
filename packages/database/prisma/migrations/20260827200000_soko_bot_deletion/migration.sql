-- Irreversible owner deletion, distinct from the reversible `archived_at`.
ALTER TABLE "orchestrator" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- One LIVE bot per user and workspace. The plain unique constraint counted
-- tombstones, so a deleted bot whose Tasks still reference it would block its
-- owner from ever creating a new one. Prisma cannot express a partial unique
-- index, so it is created here and asserted by a schema test.
DROP INDEX IF EXISTS "orchestrator_userId_workspaceId_key";

CREATE UNIQUE INDEX "orchestrator_user_workspace_live_key"
  ON "orchestrator" ("userId", "workspaceId")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "orchestrator_userId_workspaceId_idx"
  ON "orchestrator" ("userId", "workspaceId");
