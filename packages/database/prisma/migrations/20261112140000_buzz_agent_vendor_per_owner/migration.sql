-- Personal agents get one vendor per owner: Core lets a vendor's Coworkers see
-- each other's work, which must not cross between people.
INSERT INTO "vendor" ("id", "slug", "name", "listed", "updatedAt")
SELECT gen_random_uuid(), 'buzz-agents-' || owners."ownerIdentityId", 'Buzz agents', false, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT bi."ownerIdentityId"
  FROM "buzz_identity" bi
  JOIN "coworker" c ON c."id" = bi."coworkerId"
  JOIN "vendor" v ON v."id" = c."vendorId"
  WHERE v."slug" = 'buzz-agents' AND bi."ownerIdentityId" IS NOT NULL
) owners
ON CONFLICT ("slug") DO NOTHING;

UPDATE "coworker" c
SET "vendorId" = owner_vendor."id"
FROM "buzz_identity" bi, "vendor" owner_vendor, "vendor" shared
WHERE bi."coworkerId" = c."id"
  AND owner_vendor."slug" = 'buzz-agents-' || bi."ownerIdentityId"
  AND shared."id" = c."vendorId"
  AND shared."slug" = 'buzz-agents';
