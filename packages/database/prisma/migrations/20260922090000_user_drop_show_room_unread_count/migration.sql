-- Drop showRoomUnreadCount: the contract step of ADR-0038.
--
-- Superseded by "hideRoomUnreadCount" (20260921233000). Since that migration
-- nothing has read or written this column; it was kept so a rollback of that
-- deploy would find every reader's old value where it left it. Once this runs
-- there is nothing to roll back to: the value it held was the ADR-0027 opt-in,
-- which the new default made moot for every reader.
--
-- Destructive and authorized on its own (SOK-1147, layer 8). Idempotent, so a
-- retry after a partial failure is safe. Not safe to run while a Core older
-- than 20260921233000's is still serving: that version selects this column
-- on every preferences read and would 500. Deploy the previous layer first.

ALTER TABLE "user" DROP COLUMN IF EXISTS "showRoomUnreadCount";
