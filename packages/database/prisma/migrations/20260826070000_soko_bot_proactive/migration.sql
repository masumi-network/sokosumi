ALTER TABLE "soko_bot_schedule" ADD COLUMN "systemKey" TEXT;
CREATE UNIQUE INDEX "soko_bot_schedule_sokoBotId_systemKey_key" ON "soko_bot_schedule"("sokoBotId", "systemKey");

CREATE TABLE "soko_bot_nudge" (
  "id" UUID NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "lastAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "soko_bot_nudge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "soko_bot_nudge_sokoBotId_key_key" ON "soko_bot_nudge"("sokoBotId", "key");
ALTER TABLE "soko_bot_nudge" ADD CONSTRAINT "soko_bot_nudge_sokoBotId_fkey"
  FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
