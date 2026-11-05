-- Background checks a Soko Bot sets with wait_for.
CREATE TABLE "soko_bot_watch" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "projectId" TEXT,
    "then" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "outcome" TEXT,
    "firedAt" TIMESTAMP(3),
    "firedTurnId" UUID,

    CONSTRAINT "soko_bot_watch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "soko_bot_watch_status_createdAt_idx" ON "soko_bot_watch"("status", "createdAt");
CREATE INDEX "soko_bot_watch_sokoBotId_status_idx" ON "soko_bot_watch"("sokoBotId", "status");

ALTER TABLE "soko_bot_watch" ADD CONSTRAINT "soko_bot_watch_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_watch" ADD CONSTRAINT "soko_bot_watch_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
