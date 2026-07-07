-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'COWORKER_ACCESS';

-- CreateEnum
CREATE TYPE "CoworkerGrantScope" AS ENUM ('TASK_READ', 'TASK_COMMENT', 'TASK_CREATE');

-- CreateEnum
CREATE TYPE "CoworkerGrantStatus" AS ENUM ('PENDING', 'GRANTED', 'DENIED', 'REVOKED');

-- CreateTable
CREATE TABLE "coworker_grant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scope" "CoworkerGrantScope" NOT NULL,
    "status" "CoworkerGrantStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "coworkerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "coworker_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coworker_grant_userId_status_idx" ON "coworker_grant"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "coworker_grant_coworkerId_userId_scope_key" ON "coworker_grant"("coworkerId", "userId", "scope");

-- AddForeignKey
ALTER TABLE "coworker_grant" ADD CONSTRAINT "coworker_grant_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coworker_grant" ADD CONSTRAINT "coworker_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
