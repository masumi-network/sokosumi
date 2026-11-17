-- Disconnecting retires a social connection row for good, so connecting the
-- same account again made a new row while unsent posts stayed on the retired
-- one and kept asking for a reconnect. Move them onto the account's active
-- row. LinkedIn rows may hold the person URN instead of the bare id.
UPDATE "social_post" AS post
SET "socialConnectionId" = active."id",
    "updatedAt" = NOW()
FROM "project_social_connection" AS retired,
     "project_social_connection" AS active
WHERE post."socialConnectionId" = retired."id"
  AND post."status" IN ('DRAFT', 'NEEDS_APPROVAL', 'SCHEDULED', 'FAILED', 'MISSED')
  AND retired."status" = 'disconnected'
  AND active."projectId" = post."projectId"
  AND active."status" = 'active'
  AND active."provider" = retired."provider"
  AND (
    active."externalAccountId" = retired."externalAccountId"
    OR (
      retired."provider" = 'linkedin'
      AND regexp_replace(active."externalAccountId", '^urn:li:person:', '')
        = regexp_replace(retired."externalAccountId", '^urn:li:person:', '')
    )
  );
