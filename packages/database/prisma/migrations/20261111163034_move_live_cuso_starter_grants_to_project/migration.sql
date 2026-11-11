-- Starter credits granted before the grant carried its Project become Project
-- credits when their Cuso is still live (ADR 0067, SOKD-183). Grants of Cusos
-- no longer live stay in the Organization credit pool. Idempotent: a moved
-- bucket has a projectId and is no longer matched.
--
-- The grant (cmo-billing.service.ts): referenceType FREE, organization bucket,
-- no expiry, note `CMO.xyz starter credits (project <projectId>)`.
-- Live Cuso (LIVE_CUSO_WHERE, cmo-cuso.service.ts): a shared Soko Bot of the
-- Project on a CMO version (CMO_SOKO_BOT_VERSION_IDS as of this migration),
-- neither deleted nor archived.

-- Data migration
UPDATE "credit_bucket" AS cb
SET "projectId" = p."id"
FROM "project" AS p
JOIN "workspace" AS w ON w."id" = p."workspaceId"
WHERE cb."projectId" IS NULL
  AND cb."referenceType" = 'FREE'
  AND cb."userId" IS NULL
  AND cb."expiresAt" IS NULL
  AND cb."referenceNote" ~ '^CMO\.xyz starter credits \(project [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)$'
  -- Compared as text, so no cast can fail on a note that is not a UUID.
  AND p."id"::text = substring(cb."referenceNote" from '\(project ([0-9a-f-]{36})\)$')
  AND cb."organizationId" = w."organizationId"
  AND EXISTS (
    SELECT 1
    FROM "soko_bot" AS b
    WHERE b."projectId" = p."id"
      AND b."versionId" IN (
        'cmo-v1',
        'cmo-v1-qwen37-flash',
        'cmo-v1-gpt-oss-20b',
        'cmo-v1-deepseek-v4-flash',
        'cmo-v1-gemini-25-flash-lite'
      )
      AND b."userId" IS NULL
      AND b."deletedAt" IS NULL
      AND b."archivedAt" IS NULL
  );
