-- Starter credits granted before the grant carried its Project become Project
-- credits when their Cuso is still live (ADR 0067, SOKD-183). Grants of Cusos
-- no longer live stay in the Organization credit pool. Idempotent: a moved
-- bucket has a projectId and is no longer matched, so a second run writes no
-- bot and no bucket.
--
-- The grant (cmo-billing.service.ts): referenceType FREE, organization bucket,
-- no expiry, note `CMO.xyz starter credits (project <projectId>)`.
-- Live Cuso (LIVE_CUSO_WHERE, cmo-cuso.service.ts): a shared Soko Bot of the
-- Project on a CMO version (CMO_SOKO_BOT_VERSION_IDS as of this migration),
-- neither deleted nor archived.
--
-- Start over (archive) runs Serializable: it locks the bot FOR UPDATE, then
-- forfeitCusoProjectCredits reads the Project's buckets. So the live check is
-- a no-op write to each Cuso's row, in the statement that moves its grant, as
-- in writeOffUnlessLiveCuso. If Start over commits first, this Read Committed
-- UPDATE rechecks its WHERE on the archived row and skips it: the grant stays
-- in the pool. If this commits first, Start over's FOR UPDATE meets a row
-- updated since its snapshot, fails with a serialization error and retries on
-- a snapshot with the scoped bucket, which it writes off. A FOR UPDATE here
-- would let that archive go on with its stale snapshot and find nothing.

-- Data migration
WITH "starter" AS (
  SELECT cb."id", p."id" AS "projectId"
  FROM "credit_bucket" AS cb
  JOIN "project" AS p
    -- Compared as text, so no cast can fail on a note that is not a UUID.
    ON p."id"::text = substring(cb."referenceNote" from '\(project ([0-9a-f-]{36})\)$')
  JOIN "workspace" AS w ON w."id" = p."workspaceId"
  WHERE cb."projectId" IS NULL
    AND cb."referenceType" = 'FREE'
    AND cb."userId" IS NULL
    AND cb."expiresAt" IS NULL
    AND cb."referenceNote" ~ '^CMO\.xyz starter credits \(project [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)$'
    AND cb."organizationId" = w."organizationId"
),
-- Only live Cusos with a grant to move are written.
"locked" AS (
  UPDATE "soko_bot" AS b
  SET "updatedAt" = b."updatedAt"
  WHERE b."versionId" IN (
      'cmo-v1',
      'cmo-v1-qwen37-flash',
      'cmo-v1-gpt-oss-20b',
      'cmo-v1-deepseek-v4-flash',
      'cmo-v1-gemini-25-flash-lite'
    )
    AND b."userId" IS NULL
    AND b."deletedAt" IS NULL
    AND b."archivedAt" IS NULL
    AND b."projectId" IN (SELECT "projectId" FROM "starter")
  RETURNING b."projectId"
)
UPDATE "credit_bucket" AS cb
SET "projectId" = s."projectId"
FROM "starter" AS s
WHERE cb."id" = s."id"
  AND s."projectId" IN (SELECT "projectId" FROM "locked");
