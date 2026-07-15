-- Grant Serviceplan workspace access for every existing workspace.

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
  "updatedAt" = CURRENT_TIMESTAMP;
