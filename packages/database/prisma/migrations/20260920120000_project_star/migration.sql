-- One user's Pin on one project (ADR-0036). Per-user and private, so the row
-- is keyed by (userId, projectId) and carries no workspace column — a project
-- belongs to exactly one workspace, so org filtering falls out of the read.
-- "starredAt" ascending is the order the projects flyout renders pins in.
-- Unlimited per user: the flyout caps what it draws, not what is stored.

-- CreateTable
CREATE TABLE "project_star" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "starredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_star_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_star_userId_projectId_key" ON "project_star"("userId", "projectId");

-- CreateIndex
CREATE INDEX "project_star_userId_starredAt_idx" ON "project_star"("userId", "starredAt");

-- AddForeignKey
ALTER TABLE "project_star" ADD CONSTRAINT "project_star_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_star" ADD CONSTRAINT "project_star_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
