-- Vendor team membership replaces Coworker.userId ownership.
-- Backfill developers + assignments from legacy owner column, seed NMKR admins, then drop userId.

-- CreateEnum
CREATE TYPE "VendorMemberRole" AS ENUM ('admin', 'developer');

-- CreateTable
CREATE TABLE "vendor_member" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "VendorMemberRole" NOT NULL,

    CONSTRAINT "vendor_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coworker_assignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "coworkerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "coworker_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_member_userId_idx" ON "vendor_member"("userId");

-- CreateIndex
CREATE INDEX "vendor_member_vendorId_role_idx" ON "vendor_member"("vendorId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_member_vendorId_userId_key" ON "vendor_member"("vendorId", "userId");

-- CreateIndex
CREATE INDEX "coworker_assignment_userId_idx" ON "coworker_assignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "coworker_assignment_coworkerId_userId_key" ON "coworker_assignment"("coworkerId", "userId");

-- AddForeignKey
ALTER TABLE "vendor_member" ADD CONSTRAINT "vendor_member_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_member" ADD CONSTRAINT "vendor_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coworker_assignment" ADD CONSTRAINT "coworker_assignment_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coworker_assignment" ADD CONSTRAINT "coworker_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill vendor membership: one developer row per distinct (vendorId, userId) from legacy coworker owners.
INSERT INTO "vendor_member" (
  "id",
  "createdAt",
  "updatedAt",
  "vendorId",
  "userId",
  "role"
)
SELECT DISTINCT ON (c."vendorId", c."userId")
  gen_random_uuid()::TEXT,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  c."vendorId",
  c."userId",
  'developer'::"VendorMemberRole"
FROM "coworker" AS c
ORDER BY c."vendorId", c."userId", c."createdAt"
ON CONFLICT ("vendorId", "userId") DO NOTHING;

-- Backfill coworker assignments from legacy coworker owners.
INSERT INTO "coworker_assignment" (
  "id",
  "createdAt",
  "updatedAt",
  "coworkerId",
  "userId"
)
SELECT
  gen_random_uuid()::TEXT,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  c."id",
  c."userId"
FROM "coworker" AS c
ON CONFLICT ("coworkerId", "userId") DO NOTHING;

-- Seed vendor admins for NMKR accounts when user rows exist (promote developer → admin on conflict).
INSERT INTO "vendor_member" (
  "id",
  "createdAt",
  "updatedAt",
  "vendorId",
  "userId",
  "role"
)
SELECT
  gen_random_uuid()::TEXT,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  v."id",
  u."id",
  'admin'::"VendorMemberRole"
FROM "vendor" AS v
CROSS JOIN "user" AS u
WHERE u."email" IN ('andreas.osberghaus@nmkr.io', 'patrick@nmkr.io')
ON CONFLICT ("vendorId", "userId")
DO UPDATE SET
  "role" = 'admin'::"VendorMemberRole",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Drop legacy coworker ownership column and index.
DROP INDEX IF EXISTS "coworker_userId_archivedAt_idx";

ALTER TABLE "coworker" DROP CONSTRAINT "coworker_userId_fkey";

ALTER TABLE "coworker" DROP COLUMN "userId";
