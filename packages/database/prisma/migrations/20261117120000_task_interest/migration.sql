-- AlterTable
ALTER TABLE "task_participant" ADD COLUMN     "subscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "task_due_date_change" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "fromDueOn" DATE NOT NULL,
    "toDueOn" DATE NOT NULL,
    "actorUserId" TEXT,

    CONSTRAINT "task_due_date_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_moment_delivery" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "momentKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "retryAt" TIMESTAMP(3),

    CONSTRAINT "task_moment_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_due_date_change_createdAt_id_idx" ON "task_due_date_change"("createdAt", "id");

-- CreateIndex
CREATE INDEX "task_due_date_change_taskId_idx" ON "task_due_date_change"("taskId");

-- CreateIndex
CREATE INDEX "task_moment_delivery_momentKey_idx" ON "task_moment_delivery"("momentKey");

-- CreateIndex
CREATE INDEX "task_moment_delivery_taskId_idx" ON "task_moment_delivery"("taskId");

-- CreateIndex
CREATE INDEX "task_moment_delivery_retryAt_idx" ON "task_moment_delivery"("retryAt");

-- CreateIndex
CREATE UNIQUE INDEX "task_moment_delivery_userId_momentKey_key" ON "task_moment_delivery"("userId", "momentKey");

-- AddForeignKey
ALTER TABLE "task_due_date_change" ADD CONSTRAINT "task_due_date_change_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_moment_delivery" ADD CONSTRAINT "task_moment_delivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_moment_delivery" ADD CONSTRAINT "task_moment_delivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

