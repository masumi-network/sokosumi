-- The weekly "Memory cleanup" rhythm becomes nightly "Dreaming". Each bot keeps
-- its schedule row (history, and whether the owner switched it off); it now
-- runs at 03:00 in the bot's timezone, first tonight.
UPDATE "soko_bot_schedule" AS s
SET
  "systemKey" = 'dreaming',
  "name" = 'Dreaming',
  "cronExpression" = '0 3 * * *',
  "nextRunAt" = (
    (date_trunc('day', now() AT TIME ZONE s."timezone") + interval '1 day 3 hours')
      AT TIME ZONE s."timezone"
  ) AT TIME ZONE 'UTC',
  "updatedAt" = now()
WHERE s."systemKey" = 'memory-cleanup'
  AND NOT EXISTS (
    SELECT 1 FROM "soko_bot_schedule" d
    WHERE d."sokoBotId" = s."sokoBotId" AND d."systemKey" = 'dreaming'
  );

-- A bot that somehow has both keeps only Dreaming.
DELETE FROM "soko_bot_schedule" WHERE "systemKey" = 'memory-cleanup';
