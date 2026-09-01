-- Task orchestrator assignee (SOK-943). XOR with marketplace coworker assigneeId.

ALTER TABLE "task" ADD COLUMN "assigneeOrchestratorId" UUID;

ALTER TABLE "task" ADD CONSTRAINT "task_assigneeOrchestratorId_fkey"
  FOREIGN KEY ("assigneeOrchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task" ADD CONSTRAINT "task_assignee_xor_check" CHECK (
  NOT ("assigneeId" IS NOT NULL AND "assigneeOrchestratorId" IS NOT NULL)
);

CREATE INDEX "task_assigneeOrchestratorId_idx" ON "task"("assigneeOrchestratorId");
