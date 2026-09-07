-- Records the in-app delivery decision on the notification itself, so the feed
-- and the unread count can filter on it without re-reading the preference
-- matrix for every row.
--
-- Defaults to true, so every notification written before the matrix existed
-- stays visible.

-- AlterTable
ALTER TABLE "notification" ADD COLUMN "inApp" BOOLEAN NOT NULL DEFAULT true;
