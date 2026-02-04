-- Add organization reference to task
ALTER TABLE "task" ADD COLUMN "organizationId" TEXT;

-- Add foreign key
ALTER TABLE "task" ADD CONSTRAINT "task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for organizationId
CREATE INDEX "task_organizationId_idx" ON "task"("organizationId");

-- Add index for userId
CREATE INDEX "task_userId_idx" ON "task"("userId");

-- Add index for userId and organizationId
CREATE INDEX "task_userId_organizationId_idx" ON "task"("userId", "organizationId");
