-- CreateEnum
CREATE TYPE "PolarSubscriptionKind" AS ENUM ('CMO');

-- AlterEnum
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'POLAR_SUBSCRIPTION_MONTH';
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'PROJECT_TOP_UP';

-- CreateTable
CREATE TABLE "polar_subscription" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" "PolarSubscriptionKind" NOT NULL,
    "projectId" UUID,
    "organizationId" TEXT NOT NULL,
    "polarSubscriptionId" TEXT NOT NULL,
    "polarProductId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pendingPolarProductId" TEXT,
    "lastPaidOrderId" TEXT,
    "lastPaidAt" TIMESTAMP(3),
    "lastPaidOrderRefundedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "polarEventAt" TIMESTAMP(3) NOT NULL,
    "planChangeClaimedAt" TIMESTAMP(3),

    CONSTRAINT "polar_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polar_order" (
    "polarOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "polar_order_pkey" PRIMARY KEY ("polarOrderId")
);

-- CreateIndex
CREATE INDEX "polar_subscription_projectId_idx" ON "polar_subscription"("projectId");

-- CreateIndex
CREATE INDEX "polar_subscription_organizationId_idx" ON "polar_subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "polar_subscription_polarSubscriptionId_key" ON "polar_subscription"("polarSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "polar_subscription_project_live_key" ON "polar_subscription"("projectId") WHERE ("endedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "polar_subscription" ADD CONSTRAINT "polar_subscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polar_subscription" ADD CONSTRAINT "polar_subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
