-- CreateEnum
CREATE TYPE "EvalRunTrigger" AS ENUM ('DAILY', 'MANUAL');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvalResultStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "eval_run" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "trigger" "EvalRunTrigger" NOT NULL,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'QUEUED',
    "suites" TEXT[],
    "caseIds" TEXT[],
    "repeats" INTEGER NOT NULL,
    "commitSha" TEXT,
    "commitMessage" TEXT,
    "prNumber" INTEGER,
    "environment" TEXT NOT NULL,
    "label" TEXT,
    "startedByUserId" TEXT,
    "models" JSONB,

    CONSTRAINT "eval_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_result" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" UUID NOT NULL,
    "caseId" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "repeat" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "EvalResultStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "turnId" UUID,
    "state" JSONB,
    "checks" JSONB,
    "judge" JSONB,
    "judgeModel" TEXT,
    "output" JSONB,
    "error" TEXT,
    "costUsdMicros" BIGINT,
    "durationMs" INTEGER,

    CONSTRAINT "eval_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_lane" (
    "lane" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "cusoBotId" UUID,
    "cusoProjectId" UUID,
    "world" JSONB NOT NULL,

    CONSTRAINT "eval_lane_pkey" PRIMARY KEY ("lane")
);

-- CreateIndex
CREATE INDEX "eval_run_createdAt_idx" ON "eval_run"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "eval_run_status_createdAt_idx" ON "eval_run"("status", "createdAt");

-- CreateIndex
CREATE INDEX "eval_result_runId_repeat_position_idx" ON "eval_result"("runId", "repeat", "position");

-- CreateIndex
CREATE INDEX "eval_result_caseId_createdAt_idx" ON "eval_result"("caseId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "eval_result_runId_caseId_repeat_key" ON "eval_result"("runId", "caseId", "repeat");

-- CreateIndex
CREATE UNIQUE INDEX "eval_lane_workspaceId_key" ON "eval_lane"("workspaceId");

-- AddForeignKey
ALTER TABLE "eval_result" ADD CONSTRAINT "eval_result_runId_fkey" FOREIGN KEY ("runId") REFERENCES "eval_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

