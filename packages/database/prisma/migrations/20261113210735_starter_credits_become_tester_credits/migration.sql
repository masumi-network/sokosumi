-- Starter credits become Tester credits (ADR 0068, SOKD-204): every bucket a
-- Cuso's hire was granted before CMO plans is retyped from FREE to
-- CMO_TESTER_CREDITS, so code finds them by type and no longer by note. Only
-- the type changes; amount, expiry, Project, organization, reference id and
-- note stay. The note stays as stored history.
--
-- Rows: written by freeCreditAdminService.grantFreeCredits (main's
-- grantCmoStarterCredits): referenceType FREE, referenceId
-- `org:<organizationId>:free:<fresh UUID per grant>`, note
-- `CMO.xyz starter credits (<userId>)` (first version, #6835) or
-- `CMO.xyz starter credits (project <projectId>)` (#7056 on).
--
-- No collision with @@unique([referenceId, referenceType]): each retyped row
-- keeps its own reference id, distinct under FREE already; the only other
-- CMO_TESTER_CREDITS rows come from the same grant with a fresh UUID each,
-- and none exist yet when this runs (the type and its grant ship together).
--
-- The previous release reads these buckets only through raw SQL or Prisma
-- selects without referenceType, so it never decodes the new value.
--
-- Idempotent: a retyped row is no longer FREE, so a second run matches none.
--
-- Rollback:
--   UPDATE "credit_bucket" SET "referenceType" = 'FREE'
--   WHERE "referenceType" = 'CMO_TESTER_CREDITS'
--     AND "referenceNote" LIKE 'CMO.xyz starter credits%';

UPDATE "credit_bucket"
SET "referenceType" = 'CMO_TESTER_CREDITS'
WHERE "referenceType" = 'FREE'
  AND "referenceNote" LIKE 'CMO.xyz starter credits%';
