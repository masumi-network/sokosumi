CREATE TABLE "task_workspace_tag" (
    "taskId" TEXT NOT NULL,
    "labelId" UUID NOT NULL,
    CONSTRAINT "task_workspace_tag_pkey" PRIMARY KEY ("taskId", "labelId"),
    CONSTRAINT "task_workspace_tag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_workspace_tag_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "workspace_label"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "task_workspace_tag_labelId_taskId_idx" ON "task_workspace_tag"("labelId", "taskId");

-- Older writers also move Tasks. Workspace names must never follow a Task
-- into another workspace, even during a rolling deploy.
CREATE FUNCTION clear_moved_task_workspace_tags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "task_workspace_tag" WHERE "taskId" = NEW.id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER clear_moved_task_workspace_tags
AFTER UPDATE OF "workspaceId" ON "task"
FOR EACH ROW WHEN (OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId")
EXECUTE FUNCTION clear_moved_task_workspace_tags();

-- Match mapTaskTags: show manual topics first, then fill the five slots with
-- Jev topics in confidence order. Unknown IDs and rejections do not use a slot.
CREATE VIEW "task_visible_topic" AS
SELECT t.id AS "taskId", topic.id AS "topicId"
FROM "task" AS t
CROSS JOIN LATERAL (
    WITH candidates AS (
        SELECT id, 0 AS source, position FROM unnest(t."manualTags") WITH ORDINALITY AS m(id, position)
        UNION ALL
        SELECT id, 1 AS source, position FROM unnest(t."automaticTags") WITH ORDINALITY AS a(id, position)
        WHERE NOT (id = ANY(t."rejectedTags"))
    ), unique_topics AS (
        SELECT DISTINCT ON (id) id, source, position
        FROM candidates
        WHERE id IN (
            'research', 'strategy', 'writing', 'design', 'analysis', 'development',
            'marketing', 'social', 'seo', 'operations', 'presentations', 'dashboards',
            'monitoring', 'media', 'communication', 'finance', 'qa'
        )
        ORDER BY id, source, position
    )
    SELECT id FROM (
        SELECT id, source, row_number() OVER (ORDER BY source, position) AS rank
        FROM unique_topics
    ) AS ranked
    WHERE source = 0 OR rank <= 5
) AS topic;
