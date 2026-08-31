CREATE TABLE "soko_bot_installed_skill" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "markdown" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceRef" TEXT,
  CONSTRAINT "soko_bot_installed_skill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "soko_bot_installed_skill_sokoBotId_name_key" ON "soko_bot_installed_skill"("sokoBotId", "name");
CREATE INDEX "soko_bot_installed_skill_sokoBotId_idx" ON "soko_bot_installed_skill"("sokoBotId");
ALTER TABLE "soko_bot_installed_skill" ADD CONSTRAINT "soko_bot_installed_skill_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
