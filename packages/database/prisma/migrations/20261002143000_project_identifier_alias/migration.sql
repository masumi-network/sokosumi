-- A retired project prefix keeps resolving, and no other project in the
-- workspace can take it.
CREATE TABLE "project_identifier_alias" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "projectId" UUID NOT NULL,

    CONSTRAINT "project_identifier_alias_pkey" PRIMARY KEY ("workspaceId","identifier")
);

CREATE INDEX "project_identifier_alias_projectId_idx" ON "project_identifier_alias"("projectId");

ALTER TABLE "project_identifier_alias" ADD CONSTRAINT "project_identifier_alias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_identifier_alias" ADD CONSTRAINT "project_identifier_alias_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_identifier_alias" ADD CONSTRAINT "project_identifier_alias_format_check"
  CHECK ("identifier" ~ '^[A-Z][A-Z0-9]{1,6}$');

-- Automatic allocation must skip retired prefixes, or a new project named
-- like the old one would be handed the URLs those tasks still use.
CREATE OR REPLACE FUNCTION project_default_identifier(p_name TEXT, p_workspace_id UUID)
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
  PERFORM pg_advisory_xact_lock(hashtextextended('project_identifier:' || p_workspace_id::TEXT, 0));
  WHILE EXISTS (
    SELECT 1 FROM "project"
    WHERE "workspaceId" = p_workspace_id AND "identifier" = candidate
    UNION ALL
    SELECT 1 FROM "project_identifier_alias"
    WHERE "workspaceId" = p_workspace_id AND "identifier" = candidate
  ) LOOP
    suffix := suffix + 1;
    candidate := left(base, 7 - length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;
  RETURN candidate;
END;
$$;

-- Claiming another project's retired prefix fails the alias primary key,
-- which the PATCH route already maps to 409. Reclaiming our own prefix does
-- not insert here; the AFTER trigger drops that alias.
CREATE OR REPLACE FUNCTION project_set_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."identifier" IS NOT DISTINCT FROM OLD."identifier" THEN
    RETURN NEW;
  END IF;

  IF NEW."identifier" IS NULL THEN
    NEW."identifier" := project_default_identifier(NEW."name", NEW."workspaceId");
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended('project_identifier:' || NEW."workspaceId"::TEXT, 0)
    );
  END IF;

  -- Re-insert the existing alias row so the primary key fails. Pointing the
  -- row at NEW."id" would also fail the project foreign key during INSERT,
  -- before that project row exists.
  INSERT INTO "project_identifier_alias" ("workspaceId", "identifier", "projectId")
  SELECT retired."workspaceId", retired."identifier", retired."projectId"
  FROM "project_identifier_alias" AS retired
  WHERE retired."workspaceId" = NEW."workspaceId"
    AND retired."identifier" = NEW."identifier"
    AND retired."projectId" IS DISTINCT FROM NEW."id";

  RETURN NEW;
END;
$$;

CREATE FUNCTION project_alias_old_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "project_identifier_alias"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "identifier" = NEW."identifier"
    AND "projectId" = NEW."id";

  INSERT INTO "project_identifier_alias" ("workspaceId", "identifier", "projectId")
  VALUES (OLD."workspaceId", OLD."identifier", OLD."id");

  RETURN NULL;
END;
$$;

CREATE TRIGGER project_alias_old_identifier AFTER UPDATE OF "identifier" ON "project"
FOR EACH ROW
WHEN (OLD."identifier" IS NOT NULL AND OLD."identifier" IS DISTINCT FROM NEW."identifier")
EXECUTE FUNCTION project_alias_old_identifier();
