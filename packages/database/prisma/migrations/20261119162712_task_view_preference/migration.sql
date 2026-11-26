-- CreateTable
CREATE TABLE "task_view_preference" (
    "id" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "query" VARCHAR(1000) NOT NULL,

    CONSTRAINT "task_view_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_view_preference_workspaceId_idx" ON "task_view_preference"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "task_view_preference_userId_workspaceId_key" ON "task_view_preference"("userId", "workspaceId");

-- AddForeignKey
ALTER TABLE "task_view_preference" ADD CONSTRAINT "task_view_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_view_preference" ADD CONSTRAINT "task_view_preference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
