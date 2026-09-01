-- Carries the account-wide notification opt-out into the preference matrix.
--
-- `user.notificationsOptIn = false` used to stop the job and task notifications
-- from being created at all. It is the email gate alone now, so without these
-- rows every reader who turned it off would start receiving what they silenced.
--
-- Job and task only: chat and system notifications were never gated by it.
-- Both channels, because the old gate stopped the feed row and the OS banner
-- together.
--
-- Idempotent: a reader who already chose something for a cell keeps their
-- choice.

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
  "user"."id",
  category,
  channel,
  false,
  now(),
  now()
FROM "user"
CROSS JOIN (VALUES ('JOB'), ('TASK')) AS categories(category)
CROSS JOIN (VALUES ('IN_APP'), ('OS_BANNER')) AS channels(channel)
WHERE "user"."notificationsOptIn" = false
ON CONFLICT ("userId", "category", "channel") DO NOTHING;
