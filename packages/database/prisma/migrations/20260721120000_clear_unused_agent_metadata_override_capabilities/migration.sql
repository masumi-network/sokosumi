-- Capability overrides were never merged into marketplace reads and are no
-- longer on the admin write surface. Clear leftovers and drop empty rows so
-- hasOverride is not sticky after deploy.
UPDATE "AgentMetadataOverride"
SET
  "capabilityName" = NULL,
  "capabilityVersion" = NULL
WHERE
  "capabilityName" IS NOT NULL
  OR "capabilityVersion" IS NOT NULL;

DELETE FROM "AgentMetadataOverride" amo
WHERE
  amo."name" IS NULL
  AND amo."description" IS NULL
  AND amo."apiBaseUrl" IS NULL
  AND amo."capabilityName" IS NULL
  AND amo."capabilityVersion" IS NULL
  AND amo."authorName" IS NULL
  AND amo."authorImage" IS NULL
  AND amo."authorContactEmail" IS NULL
  AND amo."authorContactOther" IS NULL
  AND amo."authorOrganization" IS NULL
  AND amo."legalPrivacyPolicy" IS NULL
  AND amo."legalDpa" IS NULL
  AND amo."legalTerms" IS NULL
  AND amo."legalOther" IS NULL
  AND amo."image" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "_AgentMetadataOverrideToTag" jt
    WHERE jt."A" = amo."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ExampleOutput" eo
    WHERE eo."metadataOverrideId" = amo."id"
  );
