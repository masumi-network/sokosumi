-- Create workspace table for decoupled placement.
CREATE TABLE "workspace" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT,
  "organizationId" TEXT,

  CONSTRAINT "workspace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_owner_check" CHECK (
    ("userId" IS NOT NULL AND "organizationId" IS NULL)
    OR
    ("organizationId" IS NOT NULL AND "userId" IS NULL)
  )
);

CREATE UNIQUE INDEX "workspace_userId_key" ON "workspace"("userId");
CREATE UNIQUE INDEX "workspace_organizationId_key" ON "workspace"("organizationId");

ALTER TABLE "Job" ADD COLUMN "workspaceId" UUID;
ALTER TABLE "jobSchedule" ADD COLUMN "workspaceId" UUID;
ALTER TABLE "task" ADD COLUMN "workspaceId" UUID;

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
  "id",
  NULL
FROM "user";

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
  "id"
FROM "organization";

UPDATE "task"
SET "workspaceId" = COALESCE(
  (
    SELECT "workspace"."id"
    FROM "workspace"
    WHERE "workspace"."organizationId" = "task"."organizationId"
  ),
  (
    SELECT "workspace"."id"
    FROM "workspace"
    WHERE "workspace"."userId" = "task"."userId"
  )
);

UPDATE "Job"
SET "workspaceId" = COALESCE(
  (
    SELECT "task"."workspaceId"
    FROM "task"
    WHERE
      "task"."id" = "Job"."taskId"
      AND "task"."workspaceId" IS NOT NULL
  ),
  (
    SELECT "workspace"."id"
    FROM "workspace"
    WHERE "workspace"."organizationId" = "Job"."organizationId"
  ),
  (
    SELECT "workspace"."id"
    FROM "workspace"
    WHERE "workspace"."userId" = "Job"."userId"
  )
);

UPDATE "jobSchedule"
SET "workspaceId" = COALESCE(
  (
    SELECT "workspace"."id"
    FROM "workspace"
    WHERE "workspace"."organizationId" = "jobSchedule"."organizationId"
  ),
  (
    SELECT "workspace"."id"
    FROM "workspace"
    WHERE "workspace"."userId" = "jobSchedule"."userId"
  )
);

CREATE INDEX "Job_workspaceId_idx" ON "Job"("workspaceId");
CREATE INDEX "jobSchedule_workspaceId_idx" ON "jobSchedule"("workspaceId");
CREATE INDEX "task_workspaceId_idx" ON "task"("workspaceId");

ALTER TABLE "workspace"
ADD CONSTRAINT "workspace_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace"
ADD CONSTRAINT "workspace_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Job"
ADD CONSTRAINT "Job_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jobSchedule"
ADD CONSTRAINT "jobSchedule_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task"
ADD CONSTRAINT "task_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
