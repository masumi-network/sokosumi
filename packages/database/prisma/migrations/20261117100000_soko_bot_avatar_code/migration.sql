-- AlterTable
ALTER TABLE "soko_bot" ADD COLUMN "avatarCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_avatarCode_key" ON "soko_bot"("avatarCode");
