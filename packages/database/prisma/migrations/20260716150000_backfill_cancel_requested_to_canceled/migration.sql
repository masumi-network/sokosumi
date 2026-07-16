-- Backfill legacy cancel-request rows to terminal canceled (SOK-582).
-- Keeps CANCEL_REQUESTED enum value for audit history; no DDL change.
UPDATE "task"
SET "status" = 'CANCELED'
WHERE "status" = 'CANCEL_REQUESTED';
