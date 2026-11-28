-- The old unique index protects every write while the replacement builds.
-- No lock_timeout or IF NOT EXISTS: a cancelled build can leave an invalid
-- index. Check pg_stat_activity for a still-running build first. Once it
-- stops, fix the cause, then on DATABASE_URL_UNPOOLED run
-- DROP INDEX CONCURRENTLY IF EXISTS "soko_bot_event_inbox_network_build";
-- prisma migrate resolve --rolled-back 20261128084016_event_inbox_network_index
-- and deploy again. A plain retry stops at P3009.
CREATE UNIQUE INDEX CONCURRENTLY "soko_bot_event_inbox_network_build"
  ON "soko_bot_event_inbox" ("botId", "eventId", "purpose", (COALESCE("network", 'mainnet')));
