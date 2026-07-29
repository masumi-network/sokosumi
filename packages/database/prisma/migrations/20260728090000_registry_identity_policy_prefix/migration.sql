-- registryIdentity was previously derived only for entries whose paymentType
-- was WEB3_CARDANO_V2, but version semantics belong to the V2 registry POLICY:
-- free and EVM-only V2 agents (paymentType NONE) are versioned too.
--
-- Existing databases can therefore contain multiple Agent rows for revisions
-- of one V2 identity. Pick one canonical row deterministically:
--   1. preserve a row that already owns the stable identity;
--   2. otherwise use the highest registry version.
-- Duplicates remain as hidden historical rows so their registry-owned child
-- data is not destroyed, but their identifiers are parked to free the real
-- identifiers for the canonical row during the registry replay below.
--
-- POOLED-CONNECTION SAFETY: this migration can run through a transaction-mode
-- pooler (Neon/PgBouncer when DATABASE_URL_UNPOOLED is absent), where session
-- state does not survive across statements. The whole repair therefore runs
-- inside a single DO block: one statement, one backend, one transaction —
-- temp tables stay valid for its full duration and the repair is atomic.
DO $repair$
BEGIN

CREATE TEMP TABLE "_v2_agent_identity_repair" AS
WITH candidates AS (
  SELECT
    "id" AS "agentId",
    LOWER(LEFT("blockchainIdentifier", -6)) AS "registryIdentity",
    ('x' || RIGHT("blockchainIdentifier", 6))::bit(24)::integer AS "registryVersion",
    "blockchainIdentifier",
    "createdAt",
    CASE
      WHEN LOWER("registryIdentity") = LOWER(LEFT("blockchainIdentifier", -6)) THEN 0
      ELSE 1
    END AS "canonicalPriority"
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
      ORDER BY
        "canonicalPriority",
        "registryVersion" DESC,
        "createdAt",
        "agentId"
    ) AS "canonicalAgentId"
  FROM candidates
)
SELECT * FROM ranked;

-- Snapshot the old execution context before historical identifiers are parked,
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
-- The jsonb cast is guarded by a CASE rather than a WHERE conjunct:
-- PostgreSQL does not guarantee qual evaluation order, so an AND'ed
-- pg_input_is_valid can be evaluated AFTER the cast and one malformed legacy
-- row would abort the whole repair. Inside CASE the order is defined.
UPDATE "notification" notification
SET "metadata" = jsonb_set(
  notification."metadata"::jsonb,
  '{agentId}',
  to_jsonb(repair."canonicalAgentId")
)::text
FROM "_v2_agent_identity_repair" repair
WHERE repair."agentId" <> repair."canonicalAgentId"
  AND notification."id" IN (
    SELECT candidate."id"
    FROM "notification" candidate
    WHERE CASE
      WHEN candidate."metadata" IS NULL THEN FALSE
      WHEN NOT pg_input_is_valid(candidate."metadata", 'jsonb') THEN FALSE
      ELSE candidate."metadata"::jsonb ->> 'agentId' = repair."agentId"
    END
  );

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

-- Product-owned category assignments and registry tag relationships should
-- follow the stable row. Insert first so the join-table primary keys never
-- conflict, then remove only the duplicate rows' links.
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

-- Park duplicates before assigning the stable identity. The real on-chain
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
-- the latest revision refreshes the canonical row's scalars and collections.
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
