-- AlterTable
ALTER TABLE "soko_bot" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "projectId" UUID,
ADD COLUMN     "sharedRoomId" UUID;

-- AlterTable
ALTER TABLE "soko_bot_integration" ADD COLUMN     "connectorUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_sharedRoomId_key" ON "soko_bot"("sharedRoomId");

-- CreateIndex
CREATE INDEX "soko_bot_projectId_idx" ON "soko_bot"("projectId");

-- CreateIndex
CREATE INDEX "soko_bot_createdByUserId_idx" ON "soko_bot"("createdByUserId");

-- AddForeignKey
ALTER TABLE "soko_bot" ADD CONSTRAINT "soko_bot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot" ADD CONSTRAINT "soko_bot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot" ADD CONSTRAINT "soko_bot_sharedRoomId_fkey" FOREIGN KEY ("sharedRoomId") REFERENCES "chat_room"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Owner scope: personal (userId), project (projectId) or workspace (neither).
-- Prisma cannot express CHECK constraints, so this one lives in SQL only.
ALTER TABLE "soko_bot" ADD CONSTRAINT "soko_bot_owner_scope_check" CHECK ("userId" IS NULL OR "projectId" IS NULL);

-- Every existing bot is personal and was created by its owner.
UPDATE "soko_bot" SET "createdByUserId" = "userId" WHERE "createdByUserId" IS NULL;

-- Every existing integration was connected by its bot's owner.
UPDATE "soko_bot_integration" AS i
SET "connectorUserId" = b."userId"
FROM "soko_bot" AS b
WHERE b."id" = i."sokoBotId" AND i."connectorUserId" IS NULL;
