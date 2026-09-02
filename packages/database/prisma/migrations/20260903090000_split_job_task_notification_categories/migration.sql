-- Carries stored job and task choices into the split categories.
--
-- `JOB` became `JOB_ATTENTION` and `JOB_UPDATE`, and `TASK` became
-- `TASK_ATTENTION` and `TASK_UPDATE`. A row naming the old category belongs to
-- no row of the matrix any more, so it is dropped when the preferences are
-- read, and a reader who had silenced jobs would start receiving them again.
--
-- The rows this converts come from `20260901170000_backfill_notification_opt_out`,
-- which runs earlier in this same release and writes `JOB` and `TASK` rows for
-- every reader who had turned notifications off account-wide.
--
-- Each old row becomes two, one per new category, keeping its channel and its
-- answer. A reader who silenced jobs stays silenced on both new rows: they can
-- turn the loud one back on from the settings page, but nothing starts
-- arriving because a category was renamed under them.
--
-- Idempotent: a reader who already has a row for a new category keeps it, and
-- a database with no old rows is left untouched.

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
  split.category,
  old."channel",
  old."enabled",
  old."createdAt",
  now()
FROM "notification_preference" AS old
CROSS JOIN (VALUES ('JOB_ATTENTION'), ('JOB_UPDATE')) AS split(category)
WHERE old."category" = 'JOB'
ON CONFLICT ("userId", "category", "channel") DO NOTHING;

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
  split.category,
  old."channel",
  old."enabled",
  old."createdAt",
  now()
FROM "notification_preference" AS old
CROSS JOIN (VALUES ('TASK_ATTENTION'), ('TASK_UPDATE')) AS split(category)
WHERE old."category" = 'TASK'
ON CONFLICT ("userId", "category", "channel") DO NOTHING;

DELETE FROM "notification_preference" WHERE "category" IN ('JOB', 'TASK');
