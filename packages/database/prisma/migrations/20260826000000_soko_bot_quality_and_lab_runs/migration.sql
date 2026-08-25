ALTER TABLE "soko_bot_turn"
  ADD COLUMN "qualityScore" INTEGER,
  ADD COLUMN "qualityVerdict" JSONB,
  ADD COLUMN "qualityModel" TEXT,
  ADD COLUMN "judgedAt" TIMESTAMP(3);

CREATE TABLE "soko_bot_lab_run" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sokoBotId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "turnId" UUID NOT NULL,
  "scenarioId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "passed" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "checks" JSONB NOT NULL,
  "judge" JSONB,
  "judgeModel" TEXT,
  CONSTRAINT "soko_bot_lab_run_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "soko_bot_lab_run_turnId_key" ON "soko_bot_lab_run"("turnId");
CREATE INDEX "soko_bot_lab_run_versionId_createdAt_idx" ON "soko_bot_lab_run"("versionId", "createdAt" DESC);
CREATE INDEX "soko_bot_lab_run_sokoBotId_createdAt_idx" ON "soko_bot_lab_run"("sokoBotId", "createdAt" DESC);
ALTER TABLE "soko_bot_lab_run" ADD CONSTRAINT "soko_bot_lab_run_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_lab_run" ADD CONSTRAINT "soko_bot_lab_run_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
