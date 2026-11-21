-- Keep the last automatic tags through a content edit. They show as checking
-- until the classifier stores tags for the new revision, which still replaces
-- them only when tagContentRevision matches, so a stale result cannot land.
CREATE OR REPLACE FUNCTION task_tag_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."tagClassificationState" := 'pending';
  ELSIF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
    NEW."tagContentRevision" := OLD."tagContentRevision" + 1;
    NEW."tagClassificationState" := 'pending';
    NEW."tagClassificationAttempts" := 0;
    NEW."tagClassificationLease" := NULL;
    NEW."tagClassificationAvailableAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;
