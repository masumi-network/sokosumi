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

-- Seed every existing row with its current unique identifier. V2 identities
-- are consolidated below before the registryIdentity unique index is created.
-- Deriving the stable identity here would make revision rows collide before
-- their jobs and product-owned relations can be moved to one canonical row.
UPDATE "Agent"
SET
  "registryIdentity" = "blockchainIdentifier",
  "registryVersion" = 0;

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

-- Existing databases can contain multiple Agent rows for revisions of one V2
-- identity. Consolidate them before enforcing registryIdentity uniqueness.
-- The highest registry version becomes canonical; duplicates remain as hidden
-- historical rows so registry-owned child data is preserved. Their identifiers
-- are parked to free the real identifiers for the canonical row during replay.
--
-- POOLED-CONNECTION SAFETY: this migration can run through a transaction-mode
-- pooler, where session state does not survive across statements. Keep the
-- whole repair in one DO statement so temp tables remain available and the
-- consolidation is atomic.
DO $repair$
BEGIN

CREATE TEMP TABLE "_v2_agent_identity_repair" AS
WITH candidates AS (
  SELECT
    "id" AS "agentId",
    LOWER(LEFT("blockchainIdentifier", -6)) AS "registryIdentity",
    ('x' || RIGHT("blockchainIdentifier", 6))::bit(24)::integer AS "registryVersion",
    "blockchainIdentifier",
    "createdAt"
  FROM "Agent"
  WHERE LOWER(LEFT("blockchainIdentifier", 56)) = '67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b'
    AND LENGTH("blockchainIdentifier") = 120
    AND "blockchainIdentifier" ~ '^[0-9A-Fa-f]{120}$'
),
ranked AS (
  SELECT
    candidates.*,
    FIRST_VALUE("agentId") OVER (
      PARTITION BY "registryIdentity"
      ORDER BY "registryVersion" DESC, "createdAt", "agentId"
    ) AS "canonicalAgentId"
  FROM candidates
)
SELECT * FROM ranked;

-- Snapshot old execution context before historical identifiers are parked,
-- then attach every job to the stable product row. Existing snapshots win.
UPDATE "Job" job
SET
  "agentBlockchainIdentifier" = COALESCE(
    job."agentBlockchainIdentifier",
    agent."blockchainIdentifier"
  ),
  "agentApiBaseUrl" = COALESCE(
    job."agentApiBaseUrl",
    metadata_override."apiBaseUrl",
    agent."apiBaseUrl"
  )
FROM "_v2_agent_identity_repair" repair
JOIN "Agent" agent ON agent."id" = repair."agentId"
LEFT JOIN "AgentMetadataOverride" metadata_override
  ON metadata_override."agentId" = agent."id"
WHERE job."agentId" = repair."agentId";

UPDATE "Job" job
SET "agentId" = repair."canonicalAgentId"
FROM "_v2_agent_identity_repair" repair
WHERE job."agentId" = repair."agentId"
  AND repair."agentId" <> repair."canonicalAgentId";

-- Job notifications deep-link through metadata.agentId; retarget links that
-- point at a soon-to-be-parked duplicate row so navigation keeps resolving.
UPDATE "notification" notification
SET "metadata" = jsonb_set(
  notification."metadata"::jsonb,
  '{agentId}',
  to_jsonb(repair."canonicalAgentId")
)::text
FROM "_v2_agent_identity_repair" repair
WHERE repair."agentId" <> repair."canonicalAgentId"
  AND notification."metadata" IS NOT NULL
  AND pg_input_is_valid(notification."metadata", 'jsonb')
  AND notification."metadata"::jsonb ->> 'agentId' = repair."agentId";

-- Keep the most recently updated rating per user and stable identity, avoiding
-- the UserAgentRating(userId, agentId) unique constraint while consolidating.
CREATE TEMP TABLE "_v2_agent_rating_repair" AS
SELECT
  rating."id" AS "ratingId",
  repair."canonicalAgentId",
  ROW_NUMBER() OVER (
    PARTITION BY rating."userId", repair."canonicalAgentId"
    ORDER BY rating."updatedAt" DESC, rating."createdAt" DESC, rating."id"
  ) AS "ratingRank"
FROM "UserAgentRating" rating
JOIN "_v2_agent_identity_repair" repair
  ON repair."agentId" = rating."agentId";

DELETE FROM "UserAgentRating" rating
USING "_v2_agent_rating_repair" repair
WHERE rating."id" = repair."ratingId"
  AND repair."ratingRank" > 1;

UPDATE "UserAgentRating" rating
SET "agentId" = repair."canonicalAgentId"
FROM "_v2_agent_rating_repair" repair
WHERE rating."id" = repair."ratingId"
  AND repair."ratingRank" = 1
  AND rating."agentId" <> repair."canonicalAgentId";

-- Product-owned category assignments and registry tag relationships follow
-- the stable row. Insert first so join-table primary keys never conflict, then
-- remove only duplicate rows' links.
INSERT INTO "_AgentCategory" ("A", "B")
SELECT DISTINCT repair."canonicalAgentId", relation."B"
FROM "_AgentCategory" relation
JOIN "_v2_agent_identity_repair" repair
  ON repair."agentId" = relation."A"
ON CONFLICT DO NOTHING;

DELETE FROM "_AgentCategory" relation
USING "_v2_agent_identity_repair" repair
WHERE relation."A" = repair."agentId"
  AND repair."agentId" <> repair."canonicalAgentId";

INSERT INTO "_AgentTag" ("A", "B")
SELECT DISTINCT repair."canonicalAgentId", relation."B"
FROM "_AgentTag" relation
JOIN "_v2_agent_identity_repair" repair
  ON repair."agentId" = relation."A"
ON CONFLICT DO NOTHING;

DELETE FROM "_AgentTag" relation
USING "_v2_agent_identity_repair" repair
WHERE relation."A" = repair."agentId"
  AND repair."agentId" <> repair."canonicalAgentId";

-- Preserve one admin metadata override on the stable row. Prefer an existing
-- canonical override; otherwise move the most recently updated duplicate one.
CREATE TEMP TABLE "_v2_agent_override_repair" AS
SELECT
  metadata_override."id" AS "overrideId",
  repair."canonicalAgentId",
  ROW_NUMBER() OVER (
    PARTITION BY repair."canonicalAgentId"
    ORDER BY
      CASE
        WHEN metadata_override."agentId" = repair."canonicalAgentId" THEN 0
        ELSE 1
      END,
      metadata_override."updatedAt" DESC,
      metadata_override."createdAt" DESC,
      metadata_override."id"
  ) AS "overrideRank"
FROM "AgentMetadataOverride" metadata_override
JOIN "_v2_agent_identity_repair" repair
  ON repair."agentId" = metadata_override."agentId";

UPDATE "AgentMetadataOverride" metadata_override
SET "agentId" = repair."canonicalAgentId"
FROM "_v2_agent_override_repair" repair
WHERE metadata_override."id" = repair."overrideId"
  AND repair."overrideRank" = 1
  AND metadata_override."agentId" <> repair."canonicalAgentId";

-- Park duplicates before assigning the stable identity. Real on-chain
-- identifiers become available for the canonical row to adopt during replay.
UPDATE "Agent" agent
SET
  "blockchainIdentifier" =
    'legacy-v2:' || agent."id" || ':' || agent."blockchainIdentifier",
  "registryIdentity" =
    'legacy-v2:' || agent."id" || ':' || agent."blockchainIdentifier",
  "status" = 'INVALID',
  "isShown" = FALSE
FROM "_v2_agent_identity_repair" repair
WHERE agent."id" = repair."agentId"
  AND repair."agentId" <> repair."canonicalAgentId";

UPDATE "Agent" agent
SET
  "blockchainIdentifier" = LOWER(agent."blockchainIdentifier"),
  "registryIdentity" = repair."registryIdentity",
  "registryVersion" = repair."registryVersion"
FROM "_v2_agent_identity_repair" repair
WHERE agent."id" = repair."canonicalAgentId"
  AND repair."agentId" = repair."canonicalAgentId";

-- Replay both rollout modes. Version comparisons ignore old revisions, while
-- latest revision refreshes canonical row scalars and collections.
DELETE FROM "sync_metadata"
WHERE "key" IN (
  'agents-sync-metadata',
  'agents-sync-metadata-cardano-v2'
);

DROP TABLE "_v2_agent_override_repair";
DROP TABLE "_v2_agent_rating_repair";
DROP TABLE "_v2_agent_identity_repair";
END
$repair$;

-- Deliberately nullable for rollback compatibility: previous Core does not
-- populate registryIdentity for newly discovered V1 agents. New code always
-- writes it; PostgreSQL unique indexes allow multiple nulls.
CREATE UNIQUE INDEX "Agent_registryIdentity_key"
ON "Agent"("registryIdentity");
