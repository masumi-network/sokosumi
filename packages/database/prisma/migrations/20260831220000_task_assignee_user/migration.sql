-- Human Task assignee (SOK-868). At most one of coworker / user is set.
ALTER TABLE "task" ADD COLUMN "assigneeUserId" TEXT;

ALTER TABLE "task" ADD CONSTRAINT "task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "task_assigneeUserId_idx" ON "task"("assigneeUserId");

ALTER TABLE "task" ADD CONSTRAINT "task_assignee_at_most_one_check" CHECK (
  NOT (("assigneeId" IS NOT NULL) AND ("assigneeUserId" IS NOT NULL))
);
