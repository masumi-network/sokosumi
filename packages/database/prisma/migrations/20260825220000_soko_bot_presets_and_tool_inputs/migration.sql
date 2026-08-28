ALTER TABLE "orchestrator" ADD COLUMN "presetId" TEXT;
ALTER TABLE "soko_bot_turn" ADD COLUMN "presetId" TEXT;
ALTER TABLE "soko_bot_tool_call" ADD COLUMN "input" JSONB;
