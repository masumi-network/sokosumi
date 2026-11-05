-- SOKD-124: Contact Calendar invalidation fires only when followUpAt changes
-- (or on insert/delete of a contact that has a follow-up). Display fields
-- such as name and nextStep must not signal.

CREATE OR REPLACE FUNCTION invalidate_calendar_for_contact_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."followUpAt" IS NOT DISTINCT FROM NEW."followUpAt" THEN
      RETURN NULL;
    END IF;
  ELSIF COALESCE(NEW."followUpAt", OLD."followUpAt") IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    NULL,
    NULL,
    jsonb_build_object(
      'kind', 'contact_changed',
      'operation', lower(TG_OP),
      'contactId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$$;
