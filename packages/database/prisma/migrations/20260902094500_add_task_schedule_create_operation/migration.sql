CREATE TABLE "task_schedule_create_operation" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workspaceId" UUID NOT NULL,
  "operationId" UUID NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,

  CONSTRAINT "task_schedule_create_operation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_schedule_create_operation_workspaceId_operationId_key"
  ON "task_schedule_create_operation"("workspaceId", "operationId");

CREATE UNIQUE INDEX "task_schedule_create_operation_taskId_key"
  ON "task_schedule_create_operation"("taskId");

CREATE INDEX "task_schedule_create_operation_workspaceId_createdAt_idx"
  ON "task_schedule_create_operation"("workspaceId", "createdAt");

ALTER TABLE "task_schedule_create_operation"
  ADD CONSTRAINT "task_schedule_create_operation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_schedule_create_operation"
  ADD CONSTRAINT "task_schedule_create_operation_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
