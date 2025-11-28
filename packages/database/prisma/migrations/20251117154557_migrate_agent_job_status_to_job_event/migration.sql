-- Migrate agentJobStatus from Job table to JobEvent table
-- This migration creates JobEvent records for all existing jobs:
-- - COMPLETED/FAILED jobs: 2 events (initial AWAITING_PAYMENT + completion)
-- - RUNNING jobs: 2 events (initial AWAITING_PAYMENT + current RUNNING)
-- - Other jobs: 1 event (with their current status or AWAITING_PAYMENT)

-- A. Initial JobEvent for COMPLETED/FAILED jobs (AWAITING_PAYMENT with input data)
INSERT INTO "jobEvent" (
  id,
  "createdAt",
  "updatedAt",
  status,
  input,
  "inputSchema",
  "inputHash",
  "jobId",
  "externalId"
)
SELECT
  md5(random()::text || j.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  j."createdAt",
  j."createdAt",
  'AWAITING_PAYMENT',
  j.input,
  j."inputSchema",
  j."inputHash",
  j.id,
  NULL
FROM "Job" j
WHERE j."agentJobStatus" IN ('COMPLETED', 'FAILED');

-- B. Completion JobEvent for COMPLETED/FAILED jobs (status + result)
INSERT INTO "jobEvent" (
  id,
  "createdAt",
  "updatedAt",
  status,
  result,
  "jobId",
  "externalId"
)
SELECT
  md5(random()::text || j.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  COALESCE(j."completedAt", j."updatedAt"),
  COALESCE(j."completedAt", j."updatedAt"),
  j."agentJobStatus",
  CASE 
    WHEN j.output IS NULL THEN NULL
    ELSE j.output::jsonb->>'result'
  END,
  j.id,
  NULL
FROM "Job" j
WHERE j."agentJobStatus" IN ('COMPLETED', 'FAILED');

-- C. Initial JobEvent for RUNNING jobs (AWAITING_PAYMENT with input data)
INSERT INTO "jobEvent" (
  id,
  "createdAt",
  "updatedAt",
  status,
  input,
  "inputSchema",
  "inputHash",
  "jobId",
  "externalId"
)
SELECT
  md5(random()::text || j.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  j."createdAt",
  j."createdAt",
  'AWAITING_PAYMENT',
  j.input,
  j."inputSchema",
  j."inputHash",
  j.id,
  NULL
FROM "Job" j
WHERE j."agentJobStatus" = 'RUNNING';

-- D. Current JobEvent for RUNNING jobs (RUNNING status)
INSERT INTO "jobEvent" (
  id,
  "createdAt",
  "updatedAt",
  status,
  "jobId",
  "externalId"
)
SELECT
  md5(random()::text || j.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  COALESCE(j."updatedAt", j."startedAt", j."createdAt"),
  COALESCE(j."updatedAt", j."startedAt", j."createdAt"),
  'RUNNING',
  j.id,
  NULL
FROM "Job" j
WHERE j."agentJobStatus" = 'RUNNING';

-- E. Single JobEvent for all other jobs (AWAITING_PAYMENT, AWAITING_INPUT, or NULL)
INSERT INTO "jobEvent" (
  id,
  "createdAt",
  "updatedAt",
  status,
  input,
  "inputSchema",
  "inputHash",
  "jobId",
  "externalId"
)
SELECT
  md5(random()::text || j.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  j."createdAt",
  j."createdAt",
  COALESCE(j."agentJobStatus", 'AWAITING_PAYMENT'),
  j.input,
  j."inputSchema",
  j."inputHash",
  j.id,
  NULL
FROM "Job" j
WHERE j."agentJobStatus" IS NULL
  OR j."agentJobStatus" NOT IN ('COMPLETED', 'FAILED', 'RUNNING');

