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

-- AddForeignKey
ALTER TABLE "coworker" ADD CONSTRAINT "coworker_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
