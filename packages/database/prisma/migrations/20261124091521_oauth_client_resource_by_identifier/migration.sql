-- Better Auth links a client to a resource by the resource's `identifier`
-- (its RFC 8707 URL), not its row id, so the foreign key on
-- `oauthClientResource.resourceId` rejected every link (ADR 0076).

ALTER TABLE "oauthClientResource" DROP CONSTRAINT "oauthClientResource_resourceId_fkey";

-- A link stored by row id, if any, moves to the identifier it stands for.
UPDATE "oauthClientResource" AS link
SET "resourceId" = resource."identifier"
FROM "oauthResource" AS resource
WHERE link."resourceId" = resource."id";

ALTER TABLE "oauthClientResource"
  ADD CONSTRAINT "oauthClientResource_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;
