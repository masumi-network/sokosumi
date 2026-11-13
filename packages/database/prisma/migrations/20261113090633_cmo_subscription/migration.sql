-- AlterEnum
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'CMO_SUBSCRIPTION_MONTH';
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'PROJECT_TOP_UP';

-- CreateTable
CREATE TABLE "cmo_subscription" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
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
    "endedAt" TIMESTAMP(3),
    "polarEventAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cmo_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cmo_subscription_projectId_idx" ON "cmo_subscription"("projectId");

-- CreateIndex
CREATE INDEX "cmo_subscription_organizationId_idx" ON "cmo_subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "cmo_subscription_polarSubscriptionId_key" ON "cmo_subscription"("polarSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "cmo_subscription_project_live_key" ON "cmo_subscription"("projectId") WHERE ("endedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "cmo_subscription" ADD CONSTRAINT "cmo_subscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cmo_subscription" ADD CONSTRAINT "cmo_subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

