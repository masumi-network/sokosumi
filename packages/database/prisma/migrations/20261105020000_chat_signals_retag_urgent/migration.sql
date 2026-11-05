-- Jev v4 no longer reads a bug report as urgent. Re-read the last week's
-- messages Jev leaned urgent on; the wait lets the new code pick them up.
UPDATE "chat_message_signal"
SET "state" = 'pending',
    "attempts" = 0,
    "lease" = NULL,
    "availableAt" = now() + interval '15 minutes'
WHERE "state" = 'tagged'
  AND "taggedAt" > now() - interval '7 days'
  AND COALESCE(("probabilities" ->> 'urgent')::float, 0) >= 0.5;
