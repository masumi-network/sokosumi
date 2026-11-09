-- The crafted avatar style is gone (ADR 0064): delete its rows, its render
-- table and enums, and the columns and index it added to `soko_bot_avatar`.
-- Ships one release after the code that stopped reading them, so the old
-- deployment still serving during the build never reads a dropped column.
--
-- A row is crafted when `background` holds a colon (`<style>:<accessories>`),
-- the rule the avatar pool and 20261109094712_soko_bot_avatars_off_crafted use.
-- That migration moved every bot off its crafted avatar; a bot still showing a
-- crafted picture here falls back to its orb rather than a deleted file.

UPDATE "soko_bot" b
SET "avatarImageUrl" = NULL
FROM "soko_bot_avatar" a
WHERE a."background" LIKE '%:%'
  AND b."avatarImageUrl" = a."imageUrl";

-- Renders go with their rows (ON DELETE CASCADE) before the table is dropped.
DELETE FROM "soko_bot_avatar" WHERE "background" LIKE '%:%';

-- DropTable
DROP TABLE "soko_bot_avatar_render";

-- DropEnum
DROP TYPE "SokoBotAvatarRenderStatus";

-- DropEnum
DROP TYPE "SokoBotAvatarState";

-- DropIndex
DROP INDEX "soko_bot_avatar_styleId_styleVersion_traitKey_key";

-- DropIndex
DROP INDEX "soko_bot_avatar_keptByUserId_keptAt_idx";

-- DropIndex
DROP INDEX "soko_bot_avatar_draftForSokoBotId_idx";

-- AlterTable
ALTER TABLE "soko_bot_avatar" DROP COLUMN "draftExpiresAt",
DROP COLUMN "draftForSokoBotId",
DROP COLUMN "fromPool",
DROP COLUMN "keptAt",
DROP COLUMN "keptByUserId",
DROP COLUMN "look",
DROP COLUMN "parentAvatarId",
DROP COLUMN "styleId",
DROP COLUMN "styleVersion",
DROP COLUMN "traitKey";
