-- Backfill: every Task with events gets one CREATED event, copied from its
-- earliest event (same actor and channel) and placed 1 ms before it, so it
-- sorts first and the original events stay as they were.
-- gen_random_uuid()::text because Prisma's uuid(7) is generated client-side;
-- events sort by createdAt, so a v4 id is fine.
INSERT INTO "taskEvent" (
  "id",
  "createdAt",
  "updatedAt",
  "taskId",
  "status",
  "channel",
  "userId",
  "coworkerId",
  "sokoBotId"
)
SELECT
  gen_random_uuid()::text,
  earliest."createdAt" - interval '1 millisecond',
  earliest."createdAt" - interval '1 millisecond',
  earliest."taskId",
  'CREATED',
  earliest."channel",
  earliest."userId",
  earliest."coworkerId",
  earliest."sokoBotId"
FROM (
  SELECT DISTINCT ON ("taskId")
    "taskId", "createdAt", "channel", "userId", "coworkerId", "sokoBotId"
  FROM "taskEvent"
  ORDER BY "taskId", "createdAt", "id"
) earliest;
