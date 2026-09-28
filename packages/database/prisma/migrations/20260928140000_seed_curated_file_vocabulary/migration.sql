-- Give every existing workspace the curated Files vocabulary.
--
-- WHY THIS IS NEEDED AT ALL
-- A workspace with no vocabulary is not a workspace with a smaller feature.
-- `runSuggestionJob` counts the workspace's labels, finds none, completes
-- without calling the model and reports success. Nothing in the product ever
-- created a label — `POST /v1/drive/labels` shipped with no caller and no
-- screen — so every workspace was in that state and automatic tagging did
-- nothing at all, quietly, in all of them. New workspaces are seeded at
-- creation by `workspaceRepository.seedCuratedVocabulary`; this covers the
-- ones that already exist.
--
-- SHAPE: ONE SET-BASED STATEMENT
-- Deliberately not 20 x N rows built in application code. One statement means
-- the cost is a sequential scan of a table we are already touching, and it
-- behaves the same at ten thousand workspaces as at a million — so no row
-- count has to be known in advance for this to be safe.
--
-- IDEMPOTENT, AND SAFE TO RUN TWICE
-- `ON CONFLICT DO NOTHING` on (workspaceId, kind, normalizedName), which is
-- the unique index workspace_label_name_key. A second run inserts zero rows. A
-- workspace that already holds a hand-made label with a curated name keeps its
-- own row untouched and unmodified: that row may already carry assignments and
-- rejection tombstones keyed on its id, and overwriting it would rewrite the
-- rubric underneath suggestions that were scored against the old one.
--
-- createdByUserId IS LEFT NULL ON PURPOSE
-- That null is the provenance marker. It is the only thing distinguishing a
-- label the product shipped from one a person made, and the create route
-- always sets it from the request actor. An overwrite would leave a row that is
-- half product and half human.
--
-- gen_random_uuid() RATHER THAN uuid7
-- The column has no database default; Prisma generates uuid(7) client-side, so
-- a migration has to supply ids itself. gen_random_uuid() is what every other
-- data migration in this repository uses, including
-- 20260414104000_backfill_missing_workspaces inserting into workspace, whose
-- Prisma default is also uuid(7). workspace_label is ordered by normalizedName
-- everywhere it is read, so nothing depends on these ids being time-ordered.
--
-- THE LIST IS NOT AUTHORED HERE
-- It is `CURATED_FILE_VOCABULARY` in packages/utils/src/file-curated-vocabulary.ts,
-- and `curated-vocabulary-migration.test.ts` fails if these rows and that list
-- stop agreeing. Editing one without the other is the drift this guards.
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
    ('CATEGORY', 'Contract', 'contract', 'A binding agreement between parties: signed contracts, statements of work, NDAs, terms of service, amendments. Choose this when the document sets out obligations the parties have agreed to, not when it only proposes them.'),
    ('CATEGORY', 'Invoice or receipt', 'invoice or receipt', 'A request for payment or a record of one: invoices, receipts, credit notes, payment confirmations, account statements. Choose this when the document names amounts owed or paid, not when it merely discusses pricing.'),
    ('CATEGORY', 'Brief or specification', 'brief or specification', 'Instructions for work to be done: project briefs, requirements, technical specifications, design briefs, acceptance criteria. Choose this when the document tells someone what to build or deliver.'),
    ('CATEGORY', 'Report or analysis', 'report or analysis', 'A finding presented to a reader: research reports, analyses, audits, post-mortems, reviews of work already done. Choose this when the document draws conclusions from evidence.'),
    ('CATEGORY', 'Meeting notes', 'meeting notes', 'A record of what was said and decided: minutes, call notes, interview transcripts, workshop write-ups. Choose this when the document records a discussion rather than making an argument of its own.'),
    ('CATEGORY', 'Marketing copy', 'marketing copy', 'Text written to be published to an audience: landing-page copy, social posts, ads, newsletters, press releases, product descriptions. Choose this when the intended readers are customers rather than colleagues.'),
    ('CATEGORY', 'Dataset or export', 'dataset or export', 'Structured records rather than prose: spreadsheets, CSV exports, query results, logs, metric dumps. Choose this when the substance is rows and columns, even if prose introduces them.'),
    ('CATEGORY', 'Reference material', 'reference material', 'Something kept to be consulted later: documentation, guides, handbooks, policies, style guides, glossaries, FAQs. Choose this when the document is written to be returned to rather than read once.'),
    ('TAG', 'Finance', 'finance', 'Money: budgets, pricing, costs, revenue, payments, forecasts, financial reporting.'),
    ('TAG', 'Legal', 'legal', 'Legal exposure: contracts, compliance, licensing, liability, regulation, privacy law.'),
    ('TAG', 'Engineering', 'engineering', 'Building software: architecture, code, APIs, infrastructure, deployment, defects.'),
    ('TAG', 'Design', 'design', 'How something looks or is used: visual design, user experience, wireframes, brand assets, typography.'),
    ('TAG', 'Marketing', 'marketing', 'Reaching an audience: campaigns, channels, positioning, messaging, growth, brand.'),
    ('TAG', 'Sales', 'sales', 'Winning customers: pipeline, proposals, negotiations, customer calls, quotas, renewals.'),
    ('TAG', 'Product', 'product', 'What to build and why: roadmaps, feature decisions, user research, prioritisation, release scope.'),
    ('TAG', 'Operations', 'operations', 'Running the business day to day: process, vendors, logistics, internal tooling, procurement.'),
    ('TAG', 'People', 'people', 'The people in the organisation: hiring, onboarding, performance, roles, staff policies.'),
    ('TAG', 'Strategy', 'strategy', 'Where the organisation is going: plans, market analysis, competitive positioning, long-range goals.'),
    ('TAG', 'Security', 'security', 'Protecting systems and data: access control, vulnerabilities, incidents, audits, threat models.'),
    ('TAG', 'Research', 'research', 'Gathering evidence before deciding: market research, interviews, literature reviews, experiments.')
) AS v("kind", "displayName", "normalizedName", "description")
-- The column list, not ON CONSTRAINT: Prisma's @@unique(map:) creates a unique
-- INDEX rather than a table constraint, so ON CONSTRAINT
-- "workspace_label_name_key" errors with "constraint does not exist". The
-- column list infers the same index.
ON CONFLICT ("workspaceId", "kind", "normalizedName") DO NOTHING;
