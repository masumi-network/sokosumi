-- Manual row order. Existing rows keep their current order (by id); rows
-- inserted later default to their insert time in epoch seconds, which sorts
-- after every backfilled position.
ALTER TABLE "table_row" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT EXTRACT(epoch FROM clock_timestamp());

UPDATE "table_row" AS r
SET "position" = ordered.n
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "tableId" ORDER BY "id") AS n
  FROM "table_row"
) AS ordered
WHERE r."id" = ordered."id";

DROP INDEX "table_row_tableId_archivedAt_id_idx";
CREATE INDEX "table_row_tableId_archivedAt_position_id_idx" ON "table_row"("tableId", "archivedAt", "position", "id");

-- The Tables list is ordered by most recent change.
DROP INDEX "data_table_workspaceId_archivedAt_createdAt_id_idx";
CREATE INDEX "data_table_workspaceId_archivedAt_updatedAt_id_idx" ON "data_table"("workspaceId", "archivedAt", "updatedAt", "id");
