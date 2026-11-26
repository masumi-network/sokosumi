-- Build concurrently so the previous Core release can keep reading and writing.
-- A failed build can leave an invalid index under this name. A lock timeout
-- can cancel the build while it waits, and IF NOT EXISTS would hide the invalid
-- index. Every later production deploy stops with P3009 until a human recovers.
-- First check pg_stat_activity for a still-running CREATE INDEX targeting this
-- index. Once the build has stopped and the cause is fixed, run
-- DROP INDEX CONCURRENTLY IF EXISTS "history_network_kind_entityId_key" on DATABASE_URL_UNPOOLED,
-- then pnpm exec prisma migrate resolve --rolled-back 20261126140530_history_network_unique_index
-- on the same direct URL and deploy again. The old keys stay until cutover.

CREATE UNIQUE INDEX CONCURRENTLY "history_network_kind_entityId_key"
  ON "history" ("network", "kind", "entityId");
