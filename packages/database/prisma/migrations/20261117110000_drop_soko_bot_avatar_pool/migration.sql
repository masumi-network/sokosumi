-- DropForeignKey
ALTER TABLE "soko_bot_avatar" DROP CONSTRAINT "soko_bot_avatar_claimedBySokoBotId_fkey";

-- DropForeignKey
ALTER TABLE "soko_bot_avatar" DROP CONSTRAINT "soko_bot_avatar_requestedByUserId_fkey";

-- DropTable
DROP TABLE "soko_bot_avatar";
