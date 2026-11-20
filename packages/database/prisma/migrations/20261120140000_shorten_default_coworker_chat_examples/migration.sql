-- Shorter chat starters for the default Coworkers, so each one fits on a
-- single line on a 375 px phone (36 characters or fewer). Follows
-- 20261120130000_default_coworker_chat_examples, which stays as applied.
--
-- Only `profile.examples` changes, and only while it still holds exactly what
-- the earlier migration wrote, so an example list edited since is kept.
-- Channels, offers (the Ready-To-Run tasks) and the rest of the profile stay
-- as they are.
UPDATE "coworker" AS c
SET "metadata" = jsonb_set(c."metadata", '{profile,examples}', v.examples),
    "updatedAt" = NOW()
FROM (
  VALUES
    ('elena', '["How should we launch our new product?", "Can you help me plan a lead campaign?", "What campaign would suit this season?"]'::jsonb, '["How should we launch our product?", "Can you plan a lead campaign?", "What campaign suits this season?"]'::jsonb),
    ('hannah', '["Who are our main competitors?", "What do our customers care about most?", "How does our social media stack up?"]'::jsonb, '["Who are our main competitors?", "What do our customers care about?", "How does our social media stack up?"]'::jsonb),
    ('alex', '["Can you turn my data into a dashboard?", "Which chart fits these numbers best?", "Where do people drop out of our funnel?"]'::jsonb, '["Can you turn data into a dashboard?", "Which chart fits these numbers best?", "Where do people leave our funnel?"]'::jsonb),
    ('jamal', '["Can you map our customer journey?", "How should we split our media budget?", "How do we follow up with new leads?"]'::jsonb, '["Can you map our customer journey?", "Where should our media budget go?", "How do we follow up with new leads?"]'::jsonb),
    ('maya', '["Can you pitch me three campaign ideas?", "How can we sharpen our brand look?", "Can you outline a client pitch deck?"]'::jsonb, '["Can you pitch three campaign ideas?", "How can we sharpen our brand look?", "Can you outline a client pitch deck?"]'::jsonb)
) AS v(slug, previous, examples)
WHERE c."slug" = v.slug
  AND c."metadata" -> 'profile' -> 'examples' = v.previous;
