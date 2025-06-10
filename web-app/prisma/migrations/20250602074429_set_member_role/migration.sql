/* 
  Note: This migration is not reversible.
  It will set the role of all members to 'member' and the oldest member of each organization to 'admin'.
  It will also make the column `role` on table `member` required.
*/

UPDATE "member"
SET "role" = 'member';

UPDATE "member" m
  SET "role" = 'admin'
  FROM (
    SELECT DISTINCT ON ("organizationId") id
    FROM "member"
    ORDER BY "organizationId", "createdAt" ASC, id ASC
  ) oldest
  WHERE m.id = oldest.id;

ALTER TABLE "member" ALTER COLUMN "role" SET NOT NULL;