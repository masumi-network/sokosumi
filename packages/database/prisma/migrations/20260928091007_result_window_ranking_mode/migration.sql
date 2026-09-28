-- `file_result_window` is created by this branch (20260928091002), so this
-- alters nothing that existed before it. It is a separate migration rather
-- than an edit to that one because the earlier file has already been applied
-- to preprod, and editing an applied migration fails the checksum check.
--
-- Default 'deterministic' so a window written before this column exists —
-- at most one TTL's worth, five minutes — reports what it reported before.
ALTER TABLE "file_result_window" ADD COLUMN "rankingMode" TEXT NOT NULL DEFAULT 'deterministic';
