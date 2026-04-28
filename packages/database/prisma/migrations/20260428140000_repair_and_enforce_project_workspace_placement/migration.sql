-- Align placement workspace with the project when a task/job is linked to one.
UPDATE "task" AS t
SET "workspaceId" = p."workspaceId"
FROM "project" AS p
WHERE t."projectId" = p.id
  AND t."workspaceId" IS DISTINCT FROM p."workspaceId";

UPDATE "Job" AS j
SET "workspaceId" = p."workspaceId"
FROM "project" AS p
WHERE j."projectId" = p.id
  AND j."workspaceId" IS DISTINCT FROM p."workspaceId";

-- Enforce: projectId, when set, must reference a project in the same workspace as the row.
-- (Composite FK with ON DELETE SET NULL would null both columns and break NOT NULL on workspaceId.)
CREATE OR REPLACE FUNCTION enforce_task_project_workspace_placement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."projectId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "project" AS p
      WHERE p.id = NEW."projectId"
        AND p."workspaceId" = NEW."workspaceId"
    ) THEN
      RAISE EXCEPTION 'task projectId must reference a project in the same workspace as workspaceId'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_project_workspace_placement ON "task";

CREATE TRIGGER task_project_workspace_placement
  BEFORE INSERT OR UPDATE OF "projectId", "workspaceId" ON "task"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_task_project_workspace_placement();

CREATE OR REPLACE FUNCTION enforce_job_project_workspace_placement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."projectId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "project" AS p
      WHERE p.id = NEW."projectId"
        AND p."workspaceId" = NEW."workspaceId"
    ) THEN
      RAISE EXCEPTION 'Job projectId must reference a project in the same workspace as workspaceId'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_project_workspace_placement ON "Job";

CREATE TRIGGER job_project_workspace_placement
  BEFORE INSERT OR UPDATE OF "projectId", "workspaceId" ON "Job"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_job_project_workspace_placement();
