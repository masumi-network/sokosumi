-- Calendar outbox rows intentionally have no Workspace FK so row-level
-- mutation triggers never invert parent locks. Explicit Workspace erasure must
-- still remove all pending and published identity-bearing payloads.
CREATE OR REPLACE FUNCTION erase_calendar_outbox_for_workspace_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "calendar_invalidation_outbox"
  WHERE "workspaceId" = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER calendar_workspace_outbox_erasure
AFTER DELETE ON "workspace"
FOR EACH ROW EXECUTE FUNCTION erase_calendar_outbox_for_workspace_delete();
