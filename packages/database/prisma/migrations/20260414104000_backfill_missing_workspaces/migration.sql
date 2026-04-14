-- Backfill any users or organizations created without a workspace after the
-- original workspace placement migration.

INSERT INTO "workspace" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "organizationId"
)
SELECT
  gen_random_uuid(),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  "user"."id",
  NULL
FROM "user"
LEFT JOIN "workspace"
  ON "workspace"."userId" = "user"."id"
WHERE "workspace"."id" IS NULL;

INSERT INTO "workspace" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "organizationId"
)
SELECT
  gen_random_uuid(),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  "organization"."id"
FROM "organization"
LEFT JOIN "workspace"
  ON "workspace"."organizationId" = "organization"."id"
WHERE "workspace"."id" IS NULL;
