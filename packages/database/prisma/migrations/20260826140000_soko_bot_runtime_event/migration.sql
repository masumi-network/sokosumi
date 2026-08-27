-- Raw event log for the in-process Soko Bot runtime. The agent loop runs in a
-- background invocation and appends here; the turns drain reads it back.
CREATE TABLE "soko_bot_runtime_event" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turnId" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startIndex" INTEGER NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soko_bot_runtime_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soko_bot_runtime_event_turnId_startIndex_key"
    ON "soko_bot_runtime_event"("turnId", "startIndex");

CREATE INDEX "soko_bot_runtime_event_sessionId_startIndex_idx"
    ON "soko_bot_runtime_event"("sessionId", "startIndex");

ALTER TABLE "soko_bot_runtime_event"
    ADD CONSTRAINT "soko_bot_runtime_event_turnId_fkey"
    FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
