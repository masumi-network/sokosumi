-- Build concurrently so the previous Core release can keep reading and writing.
-- A failed build leaves an invalid index under this name. A lock timeout can
-- cancel the build while it waits, and IF NOT EXISTS would hide the invalid
-- index. A redeploy alone cannot repair it.
-- After fixing the cause, run DROP INDEX CONCURRENTLY "history_network_kind_entityId_key"
-- on DATABASE_URL_UNPOOLED, then run
-- prisma migrate resolve --rolled-back 20261126140530_history_network_unique_index
-- on the same direct URL and deploy again. The old keys stay until cutover.

CREATE UNIQUE INDEX CONCURRENTLY "history_network_kind_entityId_key"
  ON "history" ("network", "kind", "entityId");
