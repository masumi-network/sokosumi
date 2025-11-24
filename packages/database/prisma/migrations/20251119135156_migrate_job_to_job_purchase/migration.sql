-- Migrate purchase-related data from Job table to JobPurchase table
-- This migration creates JobPurchase records for all jobs that have a purchaseId
-- and copies purchase-related status fields from Job to JobPurchase
-- Note: If multiple jobs share the same purchaseId, only the first one (by id) will be migrated
-- to avoid violating the unique constraint on externalId

-- Insert JobPurchase records for jobs with purchaseId
-- Use DISTINCT ON to handle duplicate purchaseIds by selecting the first job (by id)
INSERT INTO "jobPurchase" (
  id,
  "createdAt",
  "updatedAt",
  "externalId",
  "jobId",
  "onChainStatus",
  "onChainTransactionHash",
  "onChainTransactionStatus",
  "resultHash",
  "nextAction",
  "nextActionErrorType",
  "nextActionErrorNote",
  "errorNote",
  "errorNoteKey"
)
SELECT DISTINCT ON (j."purchaseId")
  -- Generate a unique ID using hash-based approach (similar to other migrations)
  md5(random()::text || j.id::text || j."purchaseId"::text || extract(epoch from now())::text || random()::text) || substr(md5(random()::text), 1, 8),
  j."createdAt",
  j."updatedAt",
  j."purchaseId", -- Map purchaseId to externalId
  j.id, -- jobId
  j."onChainStatus",
  j."onChainTransactionHash",
  j."onChainTransactionStatus",
  j."resultHash",
  j."nextAction",
  j."nextActionErrorType",
  j."nextActionErrorNote",
  j."errorNote",
  j."errorNoteKey"
FROM "Job" j
WHERE j."purchaseId" IS NOT NULL
ORDER BY j."purchaseId", j."createdAt";

