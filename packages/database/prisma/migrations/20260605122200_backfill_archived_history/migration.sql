SELECT upsert_history_task("id")
FROM "task"
WHERE "archivedAt" IS NOT NULL;

SELECT upsert_history_conversation("id")
FROM "conversation"
WHERE "archivedAt" IS NOT NULL;
