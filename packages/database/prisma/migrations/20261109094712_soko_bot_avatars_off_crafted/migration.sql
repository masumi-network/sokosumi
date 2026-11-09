-- Soko Bot avatars go back to the original style (ADR 0064). Every Soko Bot
-- holding a crafted-style avatar gets one random unused original-style avatar
-- and its picture URL. Nothing records a bot's earlier original avatar, so the
-- pick is random (and this migration non-deterministic). When the pool runs
-- short, the remaining bots get no avatar and show their orb: this never
-- waits for generation. Deleted (tombstoned) bots never show again, so they
-- are released without a new avatar.
--
-- Crafted rows are released, not deleted; a later migration deletes them with
-- the crafted columns and render table. A row is crafted when `background`
-- holds a colon (`<style>:<accessories>`), the same rule the avatar pool uses,
-- so this reads a column that stays.

BEGIN;

-- Prisma does not wrap PostgreSQL migrations implicitly, and the old release
-- keeps claiming avatars while this runs. Lock both tables first, so no claim
-- lands between reading the pool and handing it out: one avatar never goes to
-- two bots, and the bots read here are the ones that hold a crafted-style
-- avatar at commit. EXCLUSIVE mode blocks writes and `FOR UPDATE` row locks
-- but lets plain reads through.
--
-- The app writes these tables in both orders (a claim writes the avatar, then
-- the bot; creating or reactivating a bot writes the bot, then claims), so no
-- fixed lock order is deadlock-free. Instead both locks are taken in one
-- NOWAIT statement, retried every 50 ms. A failed attempt rolls back its
-- subtransaction and so releases any lock it got, so this never waits while
-- holding a lock. After about 30 s it gives up and the deploy fails. The locks
-- hold until COMMIT.
DO $$
DECLARE
  deadline timestamptz := clock_timestamp() + interval '30 seconds';
BEGIN
  LOOP
    BEGIN
      LOCK TABLE "soko_bot_avatar", "soko_bot" IN EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() > deadline THEN
        RAISE EXCEPTION 'could not lock "soko_bot_avatar" and "soko_bot" within 30 s; retry the migration';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
END $$;

-- Bots on a crafted-style avatar, in random order.
CREATE TEMP TABLE "crafted_bot" AS
SELECT b."id", b."deletedAt", row_number() OVER (ORDER BY random()) AS "n"
FROM "soko_bot" b
JOIN "soko_bot_avatar" a ON a."claimedBySokoBotId" = b."id"
WHERE a."background" LIKE '%:%';

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

-- Pair live bots with unused avatars one to one.
CREATE TEMP TABLE "avatar_pick" AS
SELECT bot."id" AS "botId", avatar."id" AS "avatarId", avatar."imageUrl"
FROM (
  SELECT "id", row_number() OVER (ORDER BY "n") AS "n"
  FROM "crafted_bot"
  WHERE "deletedAt" IS NULL
) bot
JOIN "free_original_avatar" avatar ON avatar."n" = bot."n";

UPDATE "soko_bot_avatar" a
SET "claimedBySokoBotId" = p."botId", "claimedAt" = now()
FROM "avatar_pick" p
WHERE a."id" = p."avatarId";

-- Picked bots show their new avatar; the rest show the orb.
UPDATE "soko_bot" b
SET "avatarImageUrl" = p."imageUrl"
FROM "crafted_bot" c
LEFT JOIN "avatar_pick" p ON p."botId" = c."id"
WHERE b."id" = c."id";

DROP TABLE "avatar_pick";
DROP TABLE "free_original_avatar";
DROP TABLE "crafted_bot";

COMMIT;
