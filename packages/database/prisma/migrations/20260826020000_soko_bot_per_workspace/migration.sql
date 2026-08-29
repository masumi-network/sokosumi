-- Soko Bots are scoped to a workspace: one bot per (user, workspace).
ALTER TABLE "orchestrator" ADD COLUMN "workspaceId" UUID;

-- Backfill: the workspace of the bot's most recent turn, else the owner's personal workspace.
UPDATE "orchestrator" o
SET "workspaceId" = COALESCE(
  (SELECT t."workspaceId" FROM "soko_bot_turn" t WHERE t."sokoBotId" = o."id" ORDER BY t."createdAt" DESC LIMIT 1),
  (SELECT w."id" FROM "workspace" w WHERE w."userId" = o."userId" LIMIT 1)
);

-- Bots whose owner has no workspace at all cannot be placed anywhere.
DELETE FROM "orchestrator" WHERE "workspaceId" IS NULL;

ALTER TABLE "orchestrator" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "orchestrator" ADD CONSTRAINT "orchestrator_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "orchestrator_userId_key";
CREATE UNIQUE INDEX "orchestrator_userId_workspaceId_key" ON "orchestrator"("userId", "workspaceId");
CREATE INDEX "orchestrator_workspaceId_idx" ON "orchestrator"("workspaceId");
