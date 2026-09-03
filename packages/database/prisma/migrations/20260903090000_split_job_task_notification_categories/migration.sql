-- Carries stored job and task choices into the split categories.
--
-- `JOB` became `JOB_ATTENTION` and `JOB_UPDATE`, and `TASK` became
-- `TASK_ATTENTION` and `TASK_UPDATE`. A row naming the old category belongs to
-- no row of the matrix any more, so it is dropped when the preferences are
-- read, and a reader who had silenced jobs would start receiving them again.
--
-- Most of the rows this converts come from
-- `20260901170000_backfill_notification_opt_out`, which runs earlier in this
-- same release and writes `JOB` and `TASK` rows for every reader who had turned
-- notifications off account-wide. The rest were written by readers themselves:
-- the settings page offered `JOB` and `TASK` from the moment the preferences API
-- shipped until this migration, so a row here can hold a real choice rather than
-- the account-wide default. The conversion does not tell the two apart, and does
-- not need to: it carries whatever answer the row holds.
--
-- Each old row becomes two, one per new category, keeping its channel and its
-- answer. A reader who silenced jobs stays silenced on both new rows: they can
-- turn the loud one back on from the settings page, but nothing starts
-- arriving because a category was renamed under them.
--
-- Idempotent: a reader who already has a row for a new category keeps it, and
-- a database with no old rows is left untouched.
--
-- The existing row wins, and the old row's answer is dropped rather than merged
-- into it. A row for a new category can only have been written by a reader on a
-- settings page that already knew the split names, so it is the later of the two
-- answers.

-- The retirement comes first, before anything is read or deleted.
--
-- Core builds before it promotes, so the instance serving traffic while this
-- migration runs is still the one that offers `JOB` and `TASK` on the settings
-- page. Prisma does not wrap a migration file in one transaction, so each
-- statement below takes effect as it runs. Retiring the names first therefore
-- freezes the set of rows the rest of the file has to convert: a save that
-- lands before this statement is converted like any other, and one that lands
-- after it fails outright. A failed save is visible and can be repeated; a row
-- written behind the conversion would be silently dropped when the preferences
-- are read.
--
-- `NOT VALID` because the old rows are still here: it skips the scan over
-- existing rows and still refuses every later insert and update. The scan runs
-- at the end of the file, once the old rows are gone. Dropped first so this
-- file stays re-runnable, like the statements after it.
ALTER TABLE "notification_preference"
  DROP CONSTRAINT IF EXISTS "notification_preference_category_split_check";
ALTER TABLE "notification_preference"
  ADD CONSTRAINT "notification_preference_category_split_check" CHECK (
    "category" NOT IN ('JOB', 'TASK')
  ) NOT VALID;

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

-- Nothing named `JOB` or `TASK` is left, and the constraint above has refused
-- new ones since it was added, so this scan cannot fail.
ALTER TABLE "notification_preference"
  VALIDATE CONSTRAINT "notification_preference_category_split_check";
