-- Grants the personal-agents switch made itself, by when they were decided.
CREATE TABLE "buzz_auto_access" (
    "coworkerId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buzz_auto_access_pkey" PRIMARY KEY ("coworkerId","workspaceId")
);

-- Grants the switch made so far: granted with no resolver.
INSERT INTO "buzz_auto_access" ("coworkerId", "workspaceId", "decidedAt")
SELECT a."coworkerId", a."workspaceId", a."resolvedAt"
  FROM "coworker_workspace_access" a
  JOIN "buzz_identity" i ON i."coworkerId" = a."coworkerId"
 WHERE a.status = 'GRANTED' AND a."resolvedById" IS NULL AND a."resolvedAt" IS NOT NULL;
