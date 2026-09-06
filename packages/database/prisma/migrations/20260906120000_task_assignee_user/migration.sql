-- SOK-868: human Task assignee. At most one of coworker / sokoBot / user is set.
ALTER TABLE "task" ADD COLUMN "assigneeUserId" TEXT;

ALTER TABLE "task" ADD CONSTRAINT "task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "task_assigneeUserId_idx" ON "task"("assigneeUserId");

ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_assignee_xor_check";

ALTER TABLE "task" ADD CONSTRAINT "task_assignee_at_most_one_check" CHECK (
  (CASE WHEN "assigneeId" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "assigneeSokoBotId" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "assigneeUserId" IS NOT NULL THEN 1 ELSE 0 END)
  <= 1
);
