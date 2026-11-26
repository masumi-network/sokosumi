-- The previous Core release keeps inserting users and Organizations without
-- "preprodEnabled", so the column needs its default. A constant default is
-- stored in the catalog: no rewrite and no scan. The 5s timeout caps how long
-- each exclusive lock request can queue later reads and writes.
-- Every statement can run again. After a failed deploy, run prisma migrate
-- resolve --rolled-back 20261126220513_preprod_access_flag on the direct URL,
-- then deploy again.
SET lock_timeout = '5s';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "preprodEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "preprodEnabled" BOOLEAN NOT NULL DEFAULT false;
RESET lock_timeout;

-- No foreign keys: a record outlives its user, its Organization and its admin,
-- and creating the table locks neither of the two tables above.
CREATE TABLE IF NOT EXISTS "preprod_access_change" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,

    CONSTRAINT "preprod_access_change_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "preprod_access_change_targetType_targetId_createdAt_idx" ON "preprod_access_change"("targetType", "targetId", "createdAt");
