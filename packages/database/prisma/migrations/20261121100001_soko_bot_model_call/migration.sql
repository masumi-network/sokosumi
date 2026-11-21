-- CreateTable
CREATE TABLE "soko_bot_model_call" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turnId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "label" TEXT,
    "requestedModel" TEXT NOT NULL,
    "answeredModel" TEXT,
    "provider" TEXT,
    "region" TEXT,
    "zeroDataRetention" BOOLEAN,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "generationId" TEXT,
    "failed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "soko_bot_model_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soko_bot_model_call_turnId_createdAt_idx" ON "soko_bot_model_call"("turnId", "createdAt");

-- AddForeignKey
ALTER TABLE "soko_bot_model_call" ADD CONSTRAINT "soko_bot_model_call_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

