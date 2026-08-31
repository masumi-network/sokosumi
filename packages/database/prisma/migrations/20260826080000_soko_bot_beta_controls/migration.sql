ALTER TABLE "orchestrator"
  ADD COLUMN "proactivePaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "proactiveDailyLimit" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "soko_bot_turn"
  ADD COLUMN "ownerFeedback" INTEGER,
  ADD COLUMN "ownerFeedbackAt" TIMESTAMP(3);
ALTER TABLE "soko_bot_integration" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
-- v11 (Gemini 3.6 Flash, EU) is the default after the 2026-08-26 sweeps.
UPDATE "orchestrator" SET "versionId" = 'v11' WHERE "versionId" IS NULL OR "versionId" = 'v1';
