-- Migrate data from jobEvent to jobInput and jobStatus
-- This migration:
-- 1. Creates JobInput records from the first jobEvent per job (with input data)
-- 2. Migrates INPUT blobs from jobEvent to jobInput
-- 3. Creates JobStatus records for each jobEvent
-- 4. Links the first JobStatus to JobInput (if JobInput exists)
-- 5. Migrates OUTPUT blobs from jobEvent to jobStatus
-- 6. Migrates links from jobEvent to jobStatus

-- Step 1: Create JobInput from first jobEvent per job
-- Only create if required fields (input, inputSchema) are present
WITH first_events AS (
  SELECT DISTINCT ON ("jobId")
    id,
    "jobId",
    input,
    "inputHash",
    "inputSchema",
    signature,
    "externalId",
    "createdAt"
  FROM "jobEvent"
  WHERE input IS NOT NULL
    AND "inputSchema" IS NOT NULL
  ORDER BY "jobId", "createdAt" ASC
)
INSERT INTO "jobInput" (
  id,
  "createdAt",
  "updatedAt",
  "externalId",
  "jobId",
  "inputSchema",
  input,
  "inputHash",
  signature
)
SELECT
  md5(random()::text || fe.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  fe."createdAt",
  fe."createdAt",
  fe."externalId",
  fe."jobId",
  fe."inputSchema",
  fe.input,
  fe."inputHash",
  fe.signature
FROM first_events fe
WHERE NOT EXISTS (
  SELECT 1 FROM "jobInput" WHERE "jobId" = fe."jobId"
);

-- Step 2: Update INPUT blobs to link to jobInput
-- Only update blobs from the first jobEvent of each job
-- Note: jobEventId is kept (NOT NULL constraint) - can be removed in future migration
UPDATE blob
SET "jobInputId" = (
  SELECT ji.id
  FROM "jobInput" ji
  WHERE ji."jobId" = (
    SELECT je."jobId"
    FROM "jobEvent" je
    WHERE je.id = blob."jobEventId"
  )
)
WHERE origin = 'INPUT'
  AND "jobEventId" IN (
    SELECT je.id
    FROM "jobEvent" je
    INNER JOIN (
      SELECT DISTINCT ON ("jobId")
        id,
        "jobId"
      FROM "jobEvent"
      WHERE input IS NOT NULL
        AND "inputSchema" IS NOT NULL
      ORDER BY "jobId", "createdAt" ASC
    ) first_je ON je.id = first_je.id
  )
  AND "jobInputId" IS NULL;

-- Step 3: Create JobStatus for each jobEvent
INSERT INTO "jobStatus" (
  id,
  "createdAt",
  "updatedAt",
  "externalId",
  "jobId",
  status,
  result
)
SELECT
  md5(random()::text || je.id::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  je."createdAt",
  je."updatedAt",
  je."externalId",
  je."jobId",
  je.status,
  je.result
FROM "jobEvent" je
WHERE NOT EXISTS (
  SELECT 1
  FROM "jobStatus" js
  WHERE js."jobId" = je."jobId"
    AND js."createdAt" = je."createdAt"
    AND js.status = je.status
);

-- Step 4: Update OUTPUT blobs to link to jobStatus
-- Note: jobEventId is kept (NOT NULL constraint) - can be removed in future migration
UPDATE blob
SET "jobStatusId" = (
  SELECT js.id
  FROM "jobStatus" js
  INNER JOIN "jobEvent" je ON js."jobId" = je."jobId"
    AND js."createdAt" = je."createdAt"
    AND js.status = je.status
  WHERE je.id = blob."jobEventId"
)
WHERE origin = 'OUTPUT'
  AND "jobEventId" IS NOT NULL
  AND "jobStatusId" IS NULL;

-- Step 5: Update links to link to jobStatus
-- Note: jobEventId is kept (NOT NULL constraint) - can be removed in future migration
UPDATE link
SET "jobStatusId" = (
  SELECT js.id
  FROM "jobStatus" js
  INNER JOIN "jobEvent" je ON js."jobId" = je."jobId"
    AND js."createdAt" = je."createdAt"
    AND js.status = je.status
  WHERE je.id = link."jobEventId"
)
WHERE "jobEventId" IS NOT NULL
  AND "jobStatusId" IS NULL;
