ALTER TABLE "soko_bot_schedule_run"
ADD COLUMN "prompt" TEXT;

UPDATE "soko_bot_schedule_run" AS "run"
SET "prompt" = "schedule"."prompt"
FROM "soko_bot_schedule" AS "schedule"
WHERE "run"."scheduleId" = "schedule"."id"
  AND "run"."prompt" IS NULL;
