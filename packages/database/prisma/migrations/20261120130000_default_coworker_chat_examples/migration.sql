-- Short chat starters for the default Coworkers. An empty chat with a
-- Coworker offers its first three `profile.examples` as buttons and puts the
-- clicked one in the message box. Without examples it falls back to the
-- offers' full task prompts, which are far too long for a chat.
--
-- Only `profile.examples` changes, matched by slug. Channels, offers (the
-- Ready-To-Run tasks) and the rest of the profile stay as they are. A row
-- without metadata gets the one required key, `channels: {}`. Slugs that do
-- not exist update nothing.
UPDATE "coworker" AS c
SET "metadata" = (
      CASE WHEN jsonb_typeof(c."metadata") = 'object' THEN c."metadata" ELSE '{"channels": {}}'::jsonb END
    ) || jsonb_build_object(
      'profile',
      (
        CASE WHEN jsonb_typeof(c."metadata" -> 'profile') = 'object' THEN c."metadata" -> 'profile' ELSE '{}'::jsonb END
      ) || jsonb_build_object('examples', v.examples)
    ),
    "updatedAt" = NOW()
FROM (
  VALUES
    ('elena', '["How should we launch our new product?", "Can you help me plan a lead campaign?", "What campaign would suit this season?"]'::jsonb),
    ('hannah', '["Who are our main competitors?", "What do our customers care about most?", "How does our social media stack up?"]'::jsonb),
    ('alex', '["Can you turn my data into a dashboard?", "Which chart fits these numbers best?", "Where do people drop out of our funnel?"]'::jsonb),
    ('jamal', '["Can you map our customer journey?", "How should we split our media budget?", "How do we follow up with new leads?"]'::jsonb),
    ('maya', '["Can you pitch me three campaign ideas?", "How can we sharpen our brand look?", "Can you outline a client pitch deck?"]'::jsonb)
) AS v(slug, examples)
WHERE c."slug" = v.slug;
