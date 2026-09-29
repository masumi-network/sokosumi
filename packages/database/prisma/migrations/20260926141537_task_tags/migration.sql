-- Additive: existing tasks are not automatically backfilled.
ALTER TABLE "task"
  ADD COLUMN "automaticTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "manualTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "rejectedTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "tagContentRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "tagClassificationState" TEXT NOT NULL DEFAULT 'unclassified',
  ADD COLUMN "tagClassificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tagClassificationLease" TEXT,
  ADD COLUMN "tagClassificationAvailableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "tagVocabularyVersion" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "task_tag_queue_idx" ON "task"("tagClassificationState", "tagClassificationAvailableAt");

-- The database owns invalidation so API, schedule, and delegated writers agree.
CREATE FUNCTION task_tag_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."tagClassificationState" := 'pending';
  ELSIF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
    NEW."tagContentRevision" := OLD."tagContentRevision" + 1;
    NEW."automaticTags" := ARRAY[]::TEXT[];
    NEW."tagClassificationState" := 'pending';
    NEW."tagClassificationAttempts" := 0;
    NEW."tagClassificationLease" := NULL;
    NEW."tagClassificationAvailableAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_tag_revision BEFORE INSERT OR UPDATE OF name, description, "workspaceId"
ON "task" FOR EACH ROW EXECUTE FUNCTION task_tag_revision();
