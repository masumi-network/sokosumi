-- SOK-1046: per-task visibility (public default / private opt-in at create).
CREATE TYPE "TaskVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "task" ADD COLUMN "visibility" "TaskVisibility" NOT NULL DEFAULT 'PUBLIC';

CREATE INDEX "task_workspaceId_visibility_idx" ON "task"("workspaceId", "visibility");
