-- Jev v3 reads each chat message on its own. Re-read the last week's tags
-- with it. The rows wait 15 minutes, so the sweep that picks them up runs on
-- the new code, not the deployment this migration ships beside. Tags read
-- late never push, and readers' corrections stay.
UPDATE "chat_message_signal"
SET "state" = 'pending',
    "attempts" = 0,
    "lease" = NULL,
    "availableAt" = now() + interval '15 minutes'
WHERE "state" = 'tagged'
  AND "taggedAt" > now() - interval '7 days';
