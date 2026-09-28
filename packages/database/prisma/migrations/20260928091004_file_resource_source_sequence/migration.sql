-- Staleness for indexed native tables.
--
-- `TableChange` is an append-only log with a monotonic sequence, so a table
-- is stale exactly when its MAX(sequence) exceeds the value the index was
-- built from. Recording that value here avoids re-reading every table on
-- every sync.
ALTER TABLE "file_resource" ADD COLUMN "sourceSequence" BIGINT;
