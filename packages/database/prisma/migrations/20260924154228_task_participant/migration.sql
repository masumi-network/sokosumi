-- Formerly 20260924150000 (and before that 20260924120000). Re-timestamped
-- after the preview deploy recorded a failed apply of 20260924150000 (P3009).
-- SOK-1123: human Task participants, added only by @ in Task comments.
CREATE TABLE "task_participant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "task_participant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_participant_taskId_userId_key" ON "task_participant"("taskId", "userId");

CREATE INDEX "task_participant_userId_idx" ON "task_participant"("userId");

CREATE INDEX "task_participant_taskId_createdAt_idx" ON "task_participant"("taskId", "createdAt");

ALTER TABLE "task_participant" ADD CONSTRAINT "task_participant_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_participant" ADD CONSTRAINT "task_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
