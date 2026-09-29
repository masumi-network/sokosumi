-- Widen the curated Files vocabulary from 20 labels to 37 per workspace.
--
-- Measured on mainnet: 3 of 10 files had extracted text, and 1 of those 3 was
-- tagged. Twenty labels left most documents with nothing to match. The first
-- migration (20260928140000) seeded the original 20; this one adds only the
-- new ones, with the same idempotent, never-overwrite shape. New workspaces get
-- the whole list from `seedCuratedVocabulary`.
INSERT INTO "workspace_label" (
  "id",
  "createdAt",
  "updatedAt",
  "workspaceId",
  "kind",
  "displayName",
  "normalizedName",
  "description",
  "aliases",
  "vocabularyVersion",
  "createdByUserId"
)
SELECT
  gen_random_uuid(),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  w."id",
  v."kind"::"FileLabelKind",
  v."displayName",
  v."normalizedName",
  v."description",
  ARRAY[]::text[],
  1,
  NULL
FROM "workspace" w
CROSS JOIN (
  VALUES
    ('CATEGORY', 'Proposal or quote', 'proposal or quote', 'An offer put to someone for a decision: proposals, quotes, estimates, pitches, tenders, bids. Choose this when the document asks the reader to accept, buy or approve something.'),
    ('CATEGORY', 'Presentation', 'presentation', 'Slides made to be presented: decks, pitch decks, keynotes, workshop slides, training slides. Choose this when the document is structured as a sequence of slides.'),
    ('CATEGORY', 'Plan or roadmap', 'plan or roadmap', 'What will happen and when: project plans, roadmaps, timelines, schedules, OKRs, checklists. Choose this when the document sets out future work rather than recording past work.'),
    ('CATEGORY', 'Correspondence', 'correspondence', 'A message between people: emails, letters, chat exports, memos, announcements. Choose this when the document is addressed to a reader rather than written for the record.'),
    ('CATEGORY', 'Template or form', 'template or form', 'A document meant to be filled in or copied: templates, forms, checklists to complete, questionnaires, boilerplate. Choose this when the substance is blanks to be completed.'),
    ('TAG', 'Customer support', 'customer support', 'Helping existing customers: tickets, complaints, help-desk answers, escalations, satisfaction, troubleshooting.'),
    ('TAG', 'Data and analytics', 'data and analytics', 'Measuring and analysing: metrics, dashboards, SQL, experiments, tracking, statistics, reporting on numbers.'),
    ('TAG', 'Partnerships', 'partnerships', 'Working with other organisations: partners, integrations, resellers, agencies, joint ventures, sponsorship.'),
    ('TAG', 'Investors', 'investors', 'Raising and reporting to funders: fundraising, cap tables, investor updates, grants, valuation.'),
    ('TAG', 'Compliance', 'compliance', 'Meeting rules: audits, certifications, GDPR, policies, regulatory filings, risk registers.'),
    ('TAG', 'AI and machine learning', 'ai and machine learning', 'Models and agents: LLMs, prompts, training data, evaluation, AI agents, automation with AI.'),
    ('TAG', 'Content', 'content', 'Making things to publish: articles, blog posts, video, copywriting, editorial calendars, social media.'),
    ('TAG', 'Community', 'community', 'People around the product: users, forums, Discord, ambassadors, feedback, events for members.'),
    ('TAG', 'Documentation', 'documentation', 'Explaining how things work: guides, manuals, READMEs, runbooks, API references, onboarding docs.'),
    ('TAG', 'Events', 'events', 'Gatherings: conferences, meetups, webinars, workshops, trade shows, travel and logistics.'),
    ('TAG', 'Training', 'training', 'Teaching and learning: courses, tutorials, curricula, coaching, certification, learning material.'),
    ('TAG', 'Blockchain', 'blockchain', 'Distributed ledgers: Cardano, wallets, tokens, smart contracts, NFTs, staking, on-chain payments.')
) AS v("kind", "displayName", "normalizedName", "description")
-- The column list, not ON CONSTRAINT: Prisma's @@unique(map:) creates a unique
-- INDEX rather than a table constraint, so ON CONSTRAINT
-- "workspace_label_name_key" errors with "constraint does not exist". The
-- column list infers the same index.
ON CONFLICT ("workspaceId", "kind", "normalizedName") DO NOTHING;
