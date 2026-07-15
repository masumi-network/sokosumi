-- Serviceplan workspace grant backfill policy:
-- 1. Insert a GRANTED row for every workspace missing a Serviceplan grant.
-- 2. On conflict, upgrade only PENDING rows to GRANTED (e.g. awaiting approval).
-- 3. Never overwrite DENIED or REVOKED — those are explicit workspace decisions.
-- Matches ensureServiceplanWorkspaceGrantOnCreate: skip when any row already exists.

INSERT INTO "vendor_grant" (
  "id",
  "createdAt",
  "updatedAt",
  "vendorId",
  "workspaceId",
  "permission",
  "status",
  "resolvedAt"
)
SELECT
  gen_random_uuid(),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  v."id",
  w."id",
  'workspace'::"VendorPermission",
  'GRANTED'::"VendorGrantStatus",
  CURRENT_TIMESTAMP
FROM "workspace" AS w
CROSS JOIN "vendor" AS v
WHERE v."slug" = 'serviceplan'
ON CONFLICT ("vendorId", "workspaceId")
DO UPDATE SET
  "status" = 'GRANTED'::"VendorGrantStatus",
  "resolvedAt" = EXCLUDED."resolvedAt",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "vendor_grant"."status" = 'PENDING'::"VendorGrantStatus";
