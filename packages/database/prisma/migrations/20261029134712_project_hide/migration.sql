-- One user's Hide on one project (ADR-0036): the per-user opposite of a Pin.
-- Keyed by (userId, projectId) with no workspace column, like project_star.
-- Core deletes the user's project_star row when it writes this one, and the
-- reverse, so a project is never both Pinned and Hidden for the same reader.

-- CreateTable
CREATE TABLE "project_hide" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_hide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_hide_userId_projectId_key" ON "project_hide"("userId", "projectId");

-- CreateIndex
-- The unique key leads with userId, so the cascade from project needs its own.
CREATE INDEX "project_hide_projectId_idx" ON "project_hide"("projectId");

-- AddForeignKey
ALTER TABLE "project_hide" ADD CONSTRAINT "project_hide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_hide" ADD CONSTRAINT "project_hide_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
