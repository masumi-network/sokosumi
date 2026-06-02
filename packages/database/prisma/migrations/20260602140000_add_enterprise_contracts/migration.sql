-- AlterEnum
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'ENTERPRISE_PERIOD';
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'ENTERPRISE_TOP_UP';

-- CreateEnum
CREATE TYPE "EnterpriseContractStatus" AS ENUM ('draft', 'active', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "EnterpriseContractPeriodStatus" AS ENUM ('scheduled', 'active', 'expired', 'void');

-- CreateTable
CREATE TABLE "enterprise_contract" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "EnterpriseContractStatus" NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3),
    "periodCount" INTEGER NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "seats" INTEGER NOT NULL,
    "centsPerMonth" BIGINT NOT NULL,
    "oneTimeCents" BIGINT,
    "oneTimeExpiresAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "notes" TEXT,
    "externalReference" TEXT,

    CONSTRAINT "enterprise_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_contract_period" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contractId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "centsToGrant" BIGINT NOT NULL,
    "purchasedSeats" INTEGER NOT NULL,
    "status" "EnterpriseContractPeriodStatus" NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "enterprise_contract_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enterprise_contract_organizationId_status_idx" ON "enterprise_contract"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_contract_one_active_per_org" ON "enterprise_contract"("organizationId") WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "enterprise_contract_period_contractId_periodStart_idx" ON "enterprise_contract_period"("contractId", "periodStart");

-- CreateIndex
CREATE INDEX "enterprise_contract_period_status_periodStart_idx" ON "enterprise_contract_period"("status", "periodStart");

-- AddForeignKey
ALTER TABLE "enterprise_contract" ADD CONSTRAINT "enterprise_contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_contract_period" ADD CONSTRAINT "enterprise_contract_period_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "enterprise_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
