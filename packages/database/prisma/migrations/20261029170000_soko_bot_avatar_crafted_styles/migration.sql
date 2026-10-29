-- Crafted Soko Bot avatars (SOKD-122): every avatar records the style that drew
-- it, and a kept look gets one render row per state. Existing rows default to the
-- legacy `mascot` style and get no render rows (no backfill).

-- CreateEnum
CREATE TYPE "SokoBotAvatarState" AS ENUM ('IDLE', 'THINKING', 'WORKING', 'DONE', 'NEEDS_YOU', 'OFFLINE');

-- CreateEnum
CREATE TYPE "SokoBotAvatarRenderStatus" AS ENUM ('PENDING', 'STILL_READY', 'VIDEO_SUBMITTING', 'VIDEO_SUBMITTED', 'READY', 'SUBMISSION_UNCERTAIN', 'FAILED');

-- AlterTable
ALTER TABLE "soko_bot_avatar" ADD COLUMN     "draftExpiresAt" TIMESTAMP(3),
ADD COLUMN     "draftForSokoBotId" UUID,
ADD COLUMN     "keptAt" TIMESTAMP(3),
ADD COLUMN     "keptByUserId" TEXT,
ADD COLUMN     "look" JSONB,
ADD COLUMN     "parentAvatarId" UUID,
ADD COLUMN     "styleId" TEXT NOT NULL DEFAULT 'mascot',
ADD COLUMN     "styleVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "soko_bot_avatar_render" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "avatarId" UUID NOT NULL,
    "state" "SokoBotAvatarState" NOT NULL,
    "status" "SokoBotAvatarRenderStatus" NOT NULL DEFAULT 'PENDING',
    "stillUrl" TEXT,
    "loopUrl" TEXT,
    "loopLargeUrl" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "providerOperation" JSONB,
    "submittedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "soko_bot_avatar_render_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soko_bot_avatar_render_status_leaseUntil_idx" ON "soko_bot_avatar_render"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_avatar_render_avatarId_state_key" ON "soko_bot_avatar_render"("avatarId", "state");

-- CreateIndex
CREATE INDEX "soko_bot_avatar_keptByUserId_keptAt_idx" ON "soko_bot_avatar"("keptByUserId", "keptAt");

-- CreateIndex
CREATE INDEX "soko_bot_avatar_draftForSokoBotId_idx" ON "soko_bot_avatar"("draftForSokoBotId");

-- AddForeignKey
ALTER TABLE "soko_bot_avatar_render" ADD CONSTRAINT "soko_bot_avatar_render_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "soko_bot_avatar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

