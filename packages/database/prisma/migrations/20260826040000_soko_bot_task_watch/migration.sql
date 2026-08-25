CREATE TABLE "soko_bot_task_watch" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "taskId" TEXT NOT NULL,
  "lastSeenEventAt" TIMESTAMP(3) NOT NULL,
  "lastSeenStatus" TEXT,
  CONSTRAINT "soko_bot_task_watch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "soko_bot_task_watch_sokoBotId_taskId_key" ON "soko_bot_task_watch"("sokoBotId", "taskId");
CREATE INDEX "soko_bot_task_watch_taskId_idx" ON "soko_bot_task_watch"("taskId");
ALTER TABLE "soko_bot_task_watch" ADD CONSTRAINT "soko_bot_task_watch_sokoBotId_fkey"
  FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_task_watch" ADD CONSTRAINT "soko_bot_task_watch_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Soko Bot coworkers become assignable on the Taskboard.
UPDATE "coworker" SET "capabilities" = array_append("capabilities", 'tasks')
WHERE "sokoBotId" IS NOT NULL AND NOT ('tasks' = ANY("capabilities"));
