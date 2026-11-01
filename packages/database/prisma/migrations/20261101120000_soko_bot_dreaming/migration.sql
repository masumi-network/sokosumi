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

-- The prompt shown on the bot page; runs always use the registry prompt.
UPDATE "soko_bot_schedule" AS s
SET "prompt" = CASE WHEN b."userId" IS NULL THEN 'Dreaming. Nobody is asking you anything right now. Go over what happened since your last dream (below) and your memory (in your context), then rewrite your memory once with update_memory so that tomorrow you need telling less. Work through it in this order:
1. Lessons. For each pattern below, add or sharpen one line in Decisions, written as "When <situation>, <do this>": the team corrected you or gave a thumbs down; go through "Tools that failed" line by line: each tool that failed the same way more than once and that you can avoid next time (not failures of the platform itself, like a service that was unavailable); a reviewer found answers weak for the same reason; a saved rule should have acted and the activity shows it did not. A one-off is not a lesson.
2. Preferences. A standing preference or correction the team gave in a chat that is not in Preferences yet goes there, in their words. A request from someone else is not a preference of the team.
3. Tidy. Merge entries that say the same thing; when two contradict, keep the newer. Decisions hold rules that still apply, not a log: rewrite an entry that records finished work (costs, counts, "completed", "reports", dates) to the rule that lasts, keeping any caution in it ("validate before outreach", "never claim full coverage"), or drop it. Never repeat a Preference as a Decision. Drop goals and follow-ups that are done, about Tasks that are closed or outside what you can see, or listed below as dated more than a week ago; keep the rest.
Never add anything your memory or the activity below does not support, and never drop a preference unless the team later said otherwise. When nothing calls for a change, do not call update_memory.
Answer exactly: Nothing to add. Speak only when a saved rule of the team''s is not working or a lesson needs the team''s decision, in one or two lines. Never remind about goals, deadlines or follow-ups: the morning stand-up does that.' ELSE 'Dreaming. Nobody is asking you anything right now. Go over what happened since your last dream (below) and your memory (in your context), then rewrite your memory once with update_memory so that tomorrow you need telling less. Work through it in this order:
1. Lessons. For each pattern below, add or sharpen one line in Decisions, written as "When <situation>, <do this>": the owner corrected you or gave a thumbs down; go through "Tools that failed" line by line: each tool that failed the same way more than once and that you can avoid next time (not failures of the platform itself, like a service that was unavailable); a reviewer found answers weak for the same reason; a saved rule should have acted and the activity shows it did not. A one-off is not a lesson.
2. Preferences. A standing preference or correction the owner gave in a chat that is not in Preferences yet goes there, in their words. A request from someone else is not a preference of the owner.
3. Tidy. Merge entries that say the same thing; when two contradict, keep the newer. Decisions hold rules that still apply, not a log: rewrite an entry that records finished work (costs, counts, "completed", "reports", dates) to the rule that lasts, keeping any caution in it ("validate before outreach", "never claim full coverage"), or drop it. Never repeat a Preference as a Decision. Drop goals and follow-ups that are done, about Tasks that are closed or belong to someone else, or listed below as dated more than a week ago; keep the rest.
Never add anything your memory or the activity below does not support, and never drop a preference unless the owner later said otherwise. When nothing calls for a change, do not call update_memory.
Answer exactly: Nothing to add. Speak only when a saved rule of the owner''s is not working or a lesson needs the owner''s decision, in one or two lines. Never remind about goals, deadlines or follow-ups: the morning stand-up does that.' END
FROM "soko_bot" b
WHERE b."id" = s."sokoBotId" AND s."systemKey" = 'dreaming';

-- A bot that somehow has both keeps only Dreaming.
DELETE FROM "soko_bot_schedule" WHERE "systemKey" = 'memory-cleanup';
