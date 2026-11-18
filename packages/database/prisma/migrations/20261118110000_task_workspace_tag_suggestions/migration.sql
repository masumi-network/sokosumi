CREATE TYPE "TagColor" AS ENUM ('gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink');
CREATE TYPE "TaskWorkspaceTagState" AS ENUM ('MANUAL', 'JEV_ADDED');
CREATE TYPE "TaskWorkspaceTagDecisionState" AS ENUM ('JEV_SUGGESTED', 'JEV_DISMISSED');

ALTER TABLE "workspace_label" ADD COLUMN "color" "TagColor";
ALTER TABLE "task_workspace_tag" ADD COLUMN "state" "TaskWorkspaceTagState" NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "task_workspace_tag_decision" (
    "taskId" TEXT NOT NULL,
    "labelId" UUID NOT NULL,
    "state" "TaskWorkspaceTagDecisionState" NOT NULL,
    CONSTRAINT "task_workspace_tag_decision_pkey" PRIMARY KEY ("taskId", "labelId"),
    CONSTRAINT "task_workspace_tag_decision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_workspace_tag_decision_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "workspace_label"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "task_workspace_tag_decision_labelId_taskId_idx" ON "task_workspace_tag_decision"("labelId", "taskId");

CREATE OR REPLACE FUNCTION clear_moved_task_workspace_tags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "task_workspace_tag" WHERE "taskId" = NEW.id;
    DELETE FROM "task_workspace_tag_decision" WHERE "taskId" = NEW.id;
    RETURN NEW;
END;
$$;

-- All Task writers use the existing tag revision trigger. A new revision
-- invalidates model choices but keeps what the person accepted or dismissed.
CREATE FUNCTION invalidate_task_workspace_tag_suggestions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "task_workspace_tag" WHERE "taskId" = NEW.id AND state = 'JEV_ADDED';
    DELETE FROM "task_workspace_tag_decision" WHERE "taskId" = NEW.id AND state = 'JEV_SUGGESTED';
    RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_task_workspace_tag_suggestions
AFTER UPDATE OF name, description ON "task"
FOR EACH ROW WHEN (OLD."tagContentRevision" IS DISTINCT FROM NEW."tagContentRevision")
EXECUTE FUNCTION invalidate_task_workspace_tag_suggestions();

-- A pending offer described the earlier meaning of this label. An independent
-- color edit leaves that offer valid, and accepted labels keep their identity.
CREATE FUNCTION invalidate_changed_workspace_tag_offers() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "task_workspace_tag_decision" WHERE "labelId" = NEW.id AND state = 'JEV_SUGGESTED';
    RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_changed_workspace_tag_offers
AFTER UPDATE OF "normalizedName", description, "archivedAt" ON "workspace_label"
FOR EACH ROW WHEN (OLD."normalizedName" IS DISTINCT FROM NEW."normalizedName"
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD."archivedAt" IS DISTINCT FROM NEW."archivedAt")
EXECUTE FUNCTION invalidate_changed_workspace_tag_offers();
