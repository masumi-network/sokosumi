-- Additive: a constant default makes this a metadata-only change.
ALTER TABLE "task"
  ADD COLUMN "previousAutomaticTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A content edit still clears automaticTags, so previous Core (which reads only
-- that column) behaves as before. The cleared tags move to previousAutomaticTags,
-- where new Core shows them as checking until the new revision is classified.
-- A second edit before then keeps them; after a terminal failure nothing stale
-- carries forward.
CREATE OR REPLACE FUNCTION task_tag_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."tagClassificationState" := 'pending';
  ELSIF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
    NEW."tagContentRevision" := OLD."tagContentRevision" + 1;
    NEW."previousAutomaticTags" := CASE
      WHEN cardinality(OLD."automaticTags") > 0 THEN OLD."automaticTags"
      WHEN OLD."tagClassificationState" IN ('pending', 'running')
        THEN OLD."previousAutomaticTags"
      ELSE ARRAY[]::TEXT[]
    END;
    NEW."automaticTags" := ARRAY[]::TEXT[];
    NEW."tagClassificationState" := 'pending';
    NEW."tagClassificationAttempts" := 0;
    NEW."tagClassificationLease" := NULL;
    NEW."tagClassificationAvailableAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;
