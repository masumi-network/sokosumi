-- Hide room unread count: the sidebar's unread message count becomes on by
-- default, and a reader may switch it off (SOK-1147, ADR-0038).
--
-- A new column rather than a new default on "showRoomUnreadCount". That column
-- is NOT NULL DEFAULT false, so every existing reader holds false, and a reader
-- who never chose cannot be told from one who switched the count off. Flipping
-- it would mean rewriting every row and guessing. A column whose false means
-- "shown" starts every reader on the new default with no backfill.
--
-- Expand only. "showRoomUnreadCount" stays, unread and unwritten, so a rollback
-- finds every reader's old value where it left it. Dropping it is a later,
-- separately authorized migration.
--
-- Additive and idempotent: safe to run while the previous Core version is
-- still serving, which ignores the new column.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "hideRoomUnreadCount" BOOLEAN NOT NULL DEFAULT false;
