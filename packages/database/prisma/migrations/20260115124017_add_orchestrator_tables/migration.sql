-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "orchestrator" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "email" TEXT,
    "description" TEXT,
    "image" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "orchestrator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'DRAFT',
    "orchestratorId" TEXT,
    "attachments" TEXT[],

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taskEvents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "userId" TEXT,
    "orchestratorId" TEXT,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "taskEvents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taskComment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT[],
    "userId" TEXT,
    "orchestratorId" TEXT,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "taskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_slug_key" ON "orchestrator"("slug");

-- AddForeignKey
ALTER TABLE "orchestrator" ADD CONSTRAINT "orchestrator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvents" ADD CONSTRAINT "taskEvents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvents" ADD CONSTRAINT "taskEvents_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvents" ADD CONSTRAINT "taskEvents_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskComment" ADD CONSTRAINT "taskComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskComment" ADD CONSTRAINT "taskComment_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskComment" ADD CONSTRAINT "taskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
