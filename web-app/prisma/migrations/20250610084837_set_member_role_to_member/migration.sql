/* 
  Note: This migration is not reversible.
  It will set the role of all members to 'member' and the oldest member of each organization to 'admin'.
  It will also make the column `role` on table `member` required.
*/

UPDATE "member" SET "role" = 'member';

ALTER TABLE "member" ALTER COLUMN "role" SET NOT NULL,
ALTER COLUMN "role" SET DEFAULT 'member';