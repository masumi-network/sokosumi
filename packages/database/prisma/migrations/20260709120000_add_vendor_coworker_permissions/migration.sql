-- CreateEnum
CREATE TYPE "VendorGrantScope" AS ENUM ('VENDOR', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "VendorGrantStatus" AS ENUM ('PENDING', 'GRANTED', 'DENIED', 'REVOKED');

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoLight" TEXT,
    "logoDark" TEXT,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_slug_key" ON "vendor"("slug");

-- Seed vendors with fixed ids
INSERT INTO "vendor" ("id", "createdAt", "updatedAt", "name", "slug", "logoLight", "logoDark")
VALUES
  (
    '01960001-0001-7001-8001-000000000001',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'Serviceplan',
    'serviceplan',
    '/images/logos/serviceplan-logo.png',
    '/images/logos/serviceplan-logo-white.png'
  ),
  (
    '01960001-0001-7001-8001-000000000002',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'utxo AG',
    'utxo-ag',
    NULL,
    NULL
  ),
  (
    '01960001-0001-7001-8001-000000000003',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'Masumi',
    'masumi',
    '/images/logos/masumi-logo-black.svg',
    '/images/logos/masumi-logo-white.svg'
  );

-- AlterTable: add nullable vendorId before backfill
ALTER TABLE "coworker" ADD COLUMN "vendorId" UUID;

-- Backfill vendor assignments: Serviceplan → Serviceplan vendor; Masumi → Masumi vendor; all others → utxo AG
UPDATE "coworker"
SET "vendorId" = '01960001-0001-7001-8001-000000000001'
WHERE "company" = 'Serviceplan';

UPDATE "coworker"
SET "vendorId" = '01960001-0001-7001-8001-000000000003'
WHERE "company" = 'Masumi';

UPDATE "coworker"
SET "vendorId" = '01960001-0001-7001-8001-000000000002'
WHERE "vendorId" IS NULL;

-- Copy legacy coworker company logos into vendor light logo when not set yet (skip utxo AG)
UPDATE "vendor" AS v
SET "logoLight" = sub."companyLogo"
FROM (
  SELECT DISTINCT ON (c."vendorId") c."vendorId", c."companyLogo"
  FROM "coworker" AS c
  WHERE c."companyLogo" IS NOT NULL
  ORDER BY c."vendorId", c."updatedAt" DESC
) AS sub
WHERE v."id" = sub."vendorId"
  AND v."id" != '01960001-0001-7001-8001-000000000002'
  AND v."logoLight" IS NULL;

-- Enforce vendorId and drop legacy company fields
ALTER TABLE "coworker" ALTER COLUMN "vendorId" SET NOT NULL;

ALTER TABLE "coworker" DROP COLUMN "company",
DROP COLUMN "companyLogo";

-- CreateTable
CREATE TABLE "vendor_grant" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scope" "VendorGrantScope" NOT NULL,
    "status" "VendorGrantStatus" NOT NULL DEFAULT 'PENDING',
    "vendorId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "vendor_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_grant_userId_status_idx" ON "vendor_grant"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_grant_vendorId_userId_workspaceId_scope_key" ON "vendor_grant"("vendorId", "userId", "workspaceId", "scope");

-- AddForeignKey
ALTER TABLE "coworker" ADD CONSTRAINT "coworker_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "task" ADD COLUMN "pendingVendorGrantId" UUID;

-- CreateIndex
CREATE INDEX "task_pendingVendorGrantId_idx" ON "task"("pendingVendorGrantId");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_pendingVendorGrantId_fkey" FOREIGN KEY ("pendingVendorGrantId") REFERENCES "vendor_grant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Skip history upsert for parked tasks (owner taskboard only)
CREATE OR REPLACE FUNCTION upsert_history_task(task_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_task "task"%ROWTYPE;
BEGIN
  SELECT *
  INTO source_task
  FROM "task"
  WHERE "id" = task_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'TASK'::"HistoryKind"
      AND "entityId" = task_id;
    RETURN;
  END IF;

  IF source_task."pendingVendorGrantId" IS NOT NULL THEN
    DELETE FROM "history"
    WHERE "kind" = 'TASK'::"HistoryKind"
      AND "entityId" = task_id;
    RETURN;
  END IF;

  INSERT INTO "history" (
    "id",
    "kind",
    "entityId",
    "userId",
    "workspaceId",
    "organizationId",
    "title",
    "description",
    "status",
    "sortAt",
    "creditsCents",
    "projectId",
    "agentId",
    "coworkerId",
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'TASK'::"HistoryKind",
    source_task."id",
    source_task."userId",
    source_task."workspaceId",
    source_task."organizationId",
    source_task."name",
    source_task."description",
    source_task."status"::TEXT,
    source_task."updatedAt",
    history_task_credits_cents(source_task."id"),
    source_task."projectId",
    NULL,
    source_task."coworkerId",
    NULL,
    source_task."archivedAt"
  )
  ON CONFLICT ("kind", "entityId") DO UPDATE
  SET
    "userId" = EXCLUDED."userId",
    "workspaceId" = EXCLUDED."workspaceId",
    "organizationId" = EXCLUDED."organizationId",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "status" = EXCLUDED."status",
    "sortAt" = EXCLUDED."sortAt",
    "creditsCents" = EXCLUDED."creditsCents",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

DELETE FROM "history"
WHERE "kind" = 'TASK'::"HistoryKind"
  AND "entityId" IN (
    SELECT "id" FROM "task" WHERE "pendingVendorGrantId" IS NOT NULL
  );
