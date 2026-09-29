-- One outage clock per dependency, replacing the single shared one.
--
-- A shared timestamp could not say *what* had been failing for how long: a
-- healthy queue-status read cleared a continuing result or authorization
-- outage, and a newly failing dependency inherited the previous one's start
-- time. Each dependency now keeps its own clock.
ALTER TABLE "project_image_job"
  ADD COLUMN "statusUnreachableSince" TIMESTAMP(3),
  ADD COLUMN "resultUnreachableSince" TIMESTAMP(3),
  ADD COLUMN "authUnreachableSince"   TIMESTAMP(3);

-- Carry any outage already in flight into the column for the dependency it
-- was actually about, rather than dropping it and restarting its clock.
-- `unreachableSource` recorded that dependency; rows written before it existed
-- are attributed to the provider status read, which is where the old default
-- came from.
UPDATE "project_image_job"
SET "authUnreachableSince" = "unreachableSince"
WHERE "unreachableSince" IS NOT NULL AND "unreachableSource" = 'authorization';

UPDATE "project_image_job"
SET "resultUnreachableSince" = "unreachableSince"
WHERE "unreachableSince" IS NOT NULL AND "unreachableSource" = 'result';

UPDATE "project_image_job"
SET "statusUnreachableSince" = "unreachableSince"
WHERE "unreachableSince" IS NOT NULL
  AND ("unreachableSource" IS NULL OR "unreachableSource" NOT IN ('authorization', 'result'));

ALTER TABLE "project_image_job" DROP COLUMN "unreachableSince";
