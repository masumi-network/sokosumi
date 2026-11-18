-- CreateTable
CREATE TABLE "task_event_mention" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskEventId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "task_event_mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_event_mention_userId_answeredAt_taskId_idx" ON "task_event_mention"("userId", "answeredAt", "taskId");

-- CreateIndex
CREATE INDEX "task_event_mention_taskId_idx" ON "task_event_mention"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_event_mention_taskEventId_userId_key" ON "task_event_mention"("taskEventId", "userId");

-- AddForeignKey
ALTER TABLE "task_event_mention" ADD CONSTRAINT "task_event_mention_taskEventId_fkey" FOREIGN KEY ("taskEventId") REFERENCES "taskEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_event_mention" ADD CONSTRAINT "task_event_mention_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_event_mention" ADD CONSTRAINT "task_event_mention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

