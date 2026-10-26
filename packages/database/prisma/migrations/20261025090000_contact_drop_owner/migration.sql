-- Contacts no longer have an owner: "My contacts" are the people a member
-- has interacted with. Smart lists that asked for the reader's contacts now
-- ask for the people the reader knows; a named owner filter is dropped.
UPDATE "contact_list"
SET "smartFilter" = ("smartFilter" - 'ownedByMe' - 'mine' - 'ownerUserId')
  || CASE
    WHEN ("smartFilter" ->> 'ownedByMe') = 'true' OR ("smartFilter" ->> 'mine') = 'true'
      THEN '{"knownByMe": true}'::jsonb
    ELSE '{}'::jsonb
  END
WHERE "smartFilter" IS NOT NULL
  AND "smartFilter" ?| ARRAY['ownedByMe', 'mine', 'ownerUserId'];

ALTER TABLE "contact" DROP CONSTRAINT "contact_ownerUserId_fkey";
DROP INDEX "contact_ownerUserId_idx";
ALTER TABLE "contact" DROP COLUMN "ownerUserId";
