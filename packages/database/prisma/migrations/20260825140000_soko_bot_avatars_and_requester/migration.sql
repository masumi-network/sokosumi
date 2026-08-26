-- Mascot avatar pool, the bot's picked image, and who asked for a chat turn.
CREATE TABLE "soko_bot_avatar" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "background" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "claimedBySokoBotId" UUID,
    "claimedAt" TIMESTAMP(3),
    CONSTRAINT "soko_bot_avatar_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "soko_bot_avatar_claimedBySokoBotId_key" ON "soko_bot_avatar"("claimedBySokoBotId");
CREATE UNIQUE INDEX "soko_bot_avatar_subject_background_seed_key" ON "soko_bot_avatar"("subject", "background", "seed");
CREATE INDEX "soko_bot_avatar_claimedAt_idx" ON "soko_bot_avatar"("claimedAt");
ALTER TABLE "soko_bot_avatar" ADD CONSTRAINT "soko_bot_avatar_claimedBySokoBotId_fkey" FOREIGN KEY ("claimedBySokoBotId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orchestrator" ADD COLUMN "avatarImageUrl" TEXT;

ALTER TABLE "soko_bot_turn" ADD COLUMN "requestedByUserId" TEXT;
ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
