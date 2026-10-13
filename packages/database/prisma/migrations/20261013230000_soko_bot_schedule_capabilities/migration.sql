ALTER TABLE "soko_bot_schedule" ADD COLUMN "capabilityNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
