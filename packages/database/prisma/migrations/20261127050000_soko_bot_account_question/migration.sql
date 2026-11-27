-- CreateTable
CREATE TABLE "soko_bot_account_question" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sokoBotId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "requestedByUserId" TEXT,
    "destinationRoomId" UUID,
    "provider" TEXT NOT NULL,
    "optionIds" UUID[],
    "shownAt" TIMESTAMP(3),
    "answeredTurnId" UUID,

    CONSTRAINT "soko_bot_account_question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_account_question_turnId_provider_key" ON "soko_bot_account_question"("turnId", "provider");

-- CreateIndex
CREATE INDEX "soko_bot_account_question_sokoBotId_createdAt_idx" ON "soko_bot_account_question"("sokoBotId", "createdAt" DESC);

-- The foreign keys lock soko_bot and soko_bot_turn, both busy: the 5s
-- timeout caps how long each lock request can queue their reads and writes.
-- After a failed deploy, run prisma migrate resolve --rolled-back
-- 20261127050000_soko_bot_account_question on the direct URL, then deploy again.
SET lock_timeout = '5s';

-- AddForeignKey
ALTER TABLE "soko_bot_account_question" ADD CONSTRAINT "soko_bot_account_question_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_account_question" ADD CONSTRAINT "soko_bot_account_question_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

RESET lock_timeout;
