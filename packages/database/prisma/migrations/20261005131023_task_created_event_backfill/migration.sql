-- Backfill: every Task with events gets one CREATED event, copied from its
-- earliest event (same actor and channel) and placed 1 ms before it, so it
-- sorts first and the original events stay as they were.
-- Skip tasks that already have CREATED: Core writes that event on create
-- after the enum migration, and this backfill must run after that deploy.
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
) earliest
WHERE NOT EXISTS (
  SELECT 1
  FROM "taskEvent" existing
  WHERE existing."taskId" = earliest."taskId"
    AND existing.status = 'CREATED'
);
