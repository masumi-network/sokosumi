-- Crafted-style avatars are gone (ADR 0064): delete their rows, their render
-- table and enums, and the columns and index they added to `soko_bot_avatar`.
-- Ships one release after the code that stopped reading them, so the old
-- deployment still serving during the build never reads a dropped column.
--
-- A row is crafted when `background` holds a colon (`<style>:<accessories>`),
-- the rule the avatar pool and 20261109094712_soko_bot_avatars_off_crafted use.
-- That migration moved every bot off its crafted-style avatar, but the release
-- still serving while it ran could hand one out again (a studio keep, the old
-- picker). So this first runs the same switch once more: each bot holding a
-- crafted-style avatar, or showing a crafted picture, gets a random unused
-- original-style avatar, and when the pool runs short it shows its orb rather
-- than a deleted file. Deleted (tombstoned) bots get no new avatar.

BEGIN;

-- Prisma does not wrap PostgreSQL migrations implicitly, and the old release
-- keeps claiming avatars while this runs. Take every lock first, so no claim
-- lands between reading the pool and handing it out, and none lands on a row
-- about to be deleted. `soko_bot_avatar` and its render table get ACCESS
-- EXCLUSIVE up front because the DDL below needs it; upgrading a weaker lock
-- mid-transaction could deadlock with an in-flight claim. The render table's
-- only foreign key points at `soko_bot_avatar`, and the dropped columns have
-- none, so no other table is locked. The old release's avatar reads wait for
-- this transaction; `soko_bot` gets EXCLUSIVE, which blocks writes and
-- `FOR UPDATE` row locks but lets plain reads through.
--
-- The app writes `soko_bot_avatar` and `soko_bot` in both orders (a claim
-- writes the avatar, then the bot; creating or reactivating a bot writes the
-- bot, then claims), so no fixed lock order is deadlock-free. Instead all
-- three locks are taken NOWAIT in one attempt (one statement per lock mode),
-- retried every 50 ms. A failed attempt rolls back its subtransaction and so
-- releases any lock it got, so this never waits while holding a lock. After
-- about 30 s it gives up and the deploy fails. The locks hold until COMMIT.
DO $$
DECLARE
  deadline timestamptz := clock_timestamp() + interval '30 seconds';
BEGIN
  LOOP
    BEGIN
      LOCK TABLE "soko_bot_avatar", "soko_bot_avatar_render"
        IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE "soko_bot" IN EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() > deadline THEN
        RAISE EXCEPTION 'could not lock "soko_bot_avatar", "soko_bot_avatar_render" and "soko_bot" within 30 s; retry the migration';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
END $$;

-- Bots on a crafted-style avatar, in random order: holding a crafted row, or
-- showing a crafted picture without holding it. `heldUrl` is an original the
-- bot already holds (a bot holds at most one avatar); such a bot keeps it.
CREATE TEMP TABLE "crafted_bot" AS
SELECT b."id", b."deletedAt", held."imageUrl" AS "heldUrl",
       row_number() OVER (ORDER BY random()) AS "n"
FROM "soko_bot" b
LEFT JOIN "soko_bot_avatar" held
  ON held."claimedBySokoBotId" = b."id" AND held."background" NOT LIKE '%:%'
WHERE EXISTS (
  SELECT 1 FROM "soko_bot_avatar" a
  WHERE a."background" LIKE '%:%'
    AND (a."claimedBySokoBotId" = b."id" OR a."imageUrl" = b."avatarImageUrl")
);

-- Release the crafted rows first: `claimedBySokoBotId` is unique.
UPDATE "soko_bot_avatar"
SET "claimedBySokoBotId" = NULL, "claimedAt" = NULL
WHERE "background" LIKE '%:%' AND "claimedBySokoBotId" IS NOT NULL;

-- Unused original avatars (the pool's rule), in random order.
CREATE TEMP TABLE "free_original_avatar" AS
SELECT "id", "imageUrl", row_number() OVER (ORDER BY random()) AS "n"
FROM "soko_bot_avatar"
WHERE "claimedBySokoBotId" IS NULL
  AND "reservedAt" IS NULL
  AND "background" NOT LIKE '%:%';

-- Pair live bots that hold no original with unused avatars one to one.
CREATE TEMP TABLE "avatar_pick" AS
SELECT bot."id" AS "botId", avatar."id" AS "avatarId", avatar."imageUrl"
FROM (
  SELECT "id", row_number() OVER (ORDER BY "n") AS "n"
  FROM "crafted_bot"
  WHERE "deletedAt" IS NULL AND "heldUrl" IS NULL
) bot
JOIN "free_original_avatar" avatar ON avatar."n" = bot."n";

UPDATE "soko_bot_avatar" a
SET "claimedBySokoBotId" = p."botId", "claimedAt" = now()
FROM "avatar_pick" p
WHERE a."id" = p."avatarId";

-- Picked bots show their new avatar, a bot holding an original shows that
-- one, and the rest show the orb.
UPDATE "soko_bot" b
SET "avatarImageUrl" = COALESCE(c."heldUrl", p."imageUrl")
FROM "crafted_bot" c
LEFT JOIN "avatar_pick" p ON p."botId" = c."id"
WHERE b."id" = c."id";

DROP TABLE "avatar_pick";
DROP TABLE "free_original_avatar";
DROP TABLE "crafted_bot";

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

COMMIT;
