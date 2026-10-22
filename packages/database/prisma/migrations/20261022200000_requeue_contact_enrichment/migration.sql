-- Enrichment answers were cut off by the output limit and still marked done.
UPDATE "contact"
SET "enrichedAt" = NULL
WHERE "enrichedAt" IS NOT NULL
  AND "organization" IS NULL
  AND "role" IS NULL
  AND "summary" IS NULL
  AND "mergedIntoId" IS NULL
  AND "archivedAt" IS NULL;
