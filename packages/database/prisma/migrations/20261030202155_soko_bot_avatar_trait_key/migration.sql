-- One of a kind (SOKD-122): every pool or claimed crafted look carries the key of
-- its creature, coat, scene details and accessory, and no two share one. Drafts
-- and legacy rows have no key; Postgres treats NULLs as distinct.

-- AlterTable
ALTER TABLE "soko_bot_avatar" ADD COLUMN     "traitKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_avatar_styleId_styleVersion_traitKey_key" ON "soko_bot_avatar"("styleId", "styleVersion", "traitKey");

