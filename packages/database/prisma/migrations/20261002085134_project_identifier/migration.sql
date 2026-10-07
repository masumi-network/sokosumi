-- Project identifier: short task-id prefix, unique per workspace.
ALTER TABLE "project" ADD COLUMN "identifier" TEXT;

CREATE UNIQUE INDEX "project_workspaceId_identifier_key" ON "project"("workspaceId", "identifier");

-- Prisma cannot express CHECK constraints; this keeps bad data out of every write path.
ALTER TABLE "project" ADD CONSTRAINT "project_identifier_format_check"
  CHECK ("identifier" ~ '^[A-Z][A-Z0-9]{1,6}$');

-- The database owns the default so every create route, and the previous Core
-- release during deploy, get an identifier through one path.
-- First 3 ASCII alphanumerics of the name, accents folded (P-prefixed when it starts with a
-- digit, padded to 2), then 2, 3, ... when the workspace already uses it.
CREATE FUNCTION project_default_identifier(p_name TEXT, p_workspace_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  base TEXT := regexp_replace(upper(normalize(p_name, NFD)), '[^A-Z0-9]', '', 'g');
  candidate TEXT;
  suffix INTEGER := 1;
BEGIN
  IF base = '' THEN
    base := 'PRJ';
  ELSIF base ~ '^[0-9]' THEN
    base := 'P' || base;
  END IF;
  base := left(base, 3);
  IF length(base) < 2 THEN
    base := rpad(base, 2, 'X');
  END IF;
  candidate := base;
  -- Serialize per workspace so concurrent inserts cannot pick the same value.
  PERFORM pg_advisory_xact_lock(hashtextextended('project_identifier:' || p_workspace_id::TEXT, 0));
  WHILE EXISTS (
    SELECT 1 FROM "project"
    WHERE "workspaceId" = p_workspace_id AND "identifier" = candidate
  ) LOOP
    suffix := suffix + 1;
    candidate := left(base, 7 - length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE FUNCTION project_set_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."identifier" IS NOT DISTINCT FROM OLD."identifier" THEN
    RETURN NEW;
  END IF;

  IF NEW."identifier" IS NULL THEN
    NEW."identifier" := project_default_identifier(NEW."name", NEW."workspaceId");
  ELSE
    -- Explicit inserts and identifier PATCHes share the same per-workspace lock
    -- as automatic allocation so a concurrent create for name "Foo" cannot pick
    -- FOO and then lose the unique index to an unlocked FOO update.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('project_identifier:' || NEW."workspaceId"::TEXT, 0)
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_set_identifier BEFORE INSERT OR UPDATE OF "identifier" ON "project"
FOR EACH ROW EXECUTE FUNCTION project_set_identifier();

-- Backfill in creation order so the oldest project keeps the plain prefix.
DO $$
DECLARE
  existing RECORD;
BEGIN
  FOR existing IN
    SELECT "id", "name", "workspaceId" FROM "project"
    WHERE "identifier" IS NULL ORDER BY "createdAt", "id"
  LOOP
    UPDATE "project"
    SET "identifier" = project_default_identifier(existing."name", existing."workspaceId")
    WHERE "id" = existing."id";
  END LOOP;
END;
$$;
