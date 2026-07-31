-- CreateEnum
CREATE TYPE "AgentEntryType" AS ENUM ('STANDARD', 'OPEN_API', 'X402', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'WEB3_CARDANO_V2' BEFORE 'NONE';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "openApiSpecUrl" TEXT,
ADD COLUMN     "supersededByAgentIdentifier" TEXT,
ADD COLUMN     "type" "AgentEntryType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "x402ResourcesUrl" TEXT,
ALTER COLUMN "apiBaseUrl" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AgentPaymentSource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "chain" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "paymentSourceType" TEXT,
    "address" TEXT NOT NULL,
    "payTo" TEXT,
    "scheme" TEXT,
    "resource" TEXT,
    "pricingType" "PricingType" NOT NULL,

    CONSTRAINT "AgentPaymentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPaymentSourceAmount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentSourceId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "decimals" INTEGER,

    CONSTRAINT "AgentPaymentSourceAmount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentPaymentSource_agentId_idx" ON "AgentPaymentSource"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPaymentSource_agentId_sourceIndex_key" ON "AgentPaymentSource"("agentId", "sourceIndex");

-- CreateIndex
CREATE INDEX "AgentPaymentSourceAmount_paymentSourceId_idx" ON "AgentPaymentSourceAmount"("paymentSourceId");

-- AddForeignKey
ALTER TABLE "AgentPaymentSource" ADD CONSTRAINT "AgentPaymentSource_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPaymentSourceAmount" ADD CONSTRAINT "AgentPaymentSourceAmount_paymentSourceId_fkey" FOREIGN KEY ("paymentSourceId") REFERENCES "AgentPaymentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
