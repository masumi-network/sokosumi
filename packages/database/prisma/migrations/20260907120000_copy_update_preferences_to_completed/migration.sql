-- Completed jobs and tasks moved out of their former update categories.
-- Keep each reader's existing update choice for the new completed category.
-- An explicit completed preference wins when one already exists.

INSERT INTO "notification_preference" (
  "id",
  "userId",
  "category",
  "channel",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  old."userId",
  completed.category,
  old."channel",
  old."enabled",
  old."createdAt",
  now()
FROM "notification_preference" AS old
JOIN (
  VALUES
    ('JOB_UPDATE', 'JOB_COMPLETED'),
    ('TASK_UPDATE', 'TASK_COMPLETED')
) AS completed(old_category, category) ON old."category" = completed.old_category
ON CONFLICT ("userId", "category", "channel") DO NOTHING;
