-- AlterEnum
ALTER TYPE "AgentEntryType" ADD VALUE 'UNKNOWN';

-- Preserve the x402 routing fields already present in registry payment sources.
ALTER TABLE "AgentPaymentSource"
ADD COLUMN "scheme" TEXT,
ADD COLUMN "resource" TEXT;

-- Keep one stable Agent row across V2 registry revisions. A V2 identifier is
-- policy + nonce/root + a 3-byte version suffix, so the versionless prefix is
-- the stable identity.
ALTER TABLE "Agent"
ADD COLUMN "registryIdentity" TEXT,
ADD COLUMN "registryVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE "Agent"
SET
  "registryIdentity" = CASE
    WHEN "paymentType" = 'WEB3_CARDANO_V2'
      AND LENGTH("blockchainIdentifier") > 6
      AND RIGHT("blockchainIdentifier", 6) ~ '^[0-9A-Fa-f]{6}$'
    THEN LEFT("blockchainIdentifier", -6)
    ELSE "blockchainIdentifier"
  END,
  "registryVersion" = CASE
    WHEN "paymentType" = 'WEB3_CARDANO_V2'
      AND LENGTH("blockchainIdentifier") > 6
      AND RIGHT("blockchainIdentifier", 6) ~ '^[0-9A-Fa-f]{6}$'
    THEN ('x' || RIGHT("blockchainIdentifier", 6))::bit(24)::integer
    ELSE 0
  END;

-- Deliberately remains nullable for rollback compatibility: the previous Core
-- release does not populate this column when inserting a newly discovered V1
-- agent. New code always writes it; a later migration can tighten the column.
CREATE UNIQUE INDEX "Agent_registryIdentity_key"
ON "Agent"("registryIdentity");

-- Snapshot the agent execution revision for every job and the V2 payment
-- source selection for paid jobs, even after the stable Agent row advances.
ALTER TABLE "Job"
ADD COLUMN "agentBlockchainIdentifier" TEXT,
ADD COLUMN "agentApiBaseUrl" TEXT,
ADD COLUMN "paymentSourceType" TEXT,
ADD COLUMN "supportedPaymentSourceIndex" INTEGER;

ALTER TABLE "Job"
ADD CONSTRAINT "Job_supportedPaymentSourceIndex_check"
CHECK (
  "supportedPaymentSourceIndex" IS NULL
  OR "supportedPaymentSourceIndex" BETWEEN 0 AND 24
);
