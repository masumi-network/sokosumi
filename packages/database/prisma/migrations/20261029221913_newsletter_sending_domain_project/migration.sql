BEGIN;

-- Preserve every Resend registration: a workspace without a Project needs an
-- explicit destination before this migration can proceed. See _agent-notes/MIGRATION.md.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "newsletter_sending_domain" AS sending_domain
    WHERE NOT EXISTS (
      SELECT 1 FROM "project" WHERE "workspaceId" = sending_domain."workspaceId"
    )
  ) THEN
    RAISE EXCEPTION 'Newsletter sending domain migration requires a Project in every workspace with a sending domain; create a destination Project before retrying';
  END IF;
END $$;

ALTER TABLE "newsletter_sending_domain" ADD COLUMN "projectId" UUID;

-- Keep each domain on exactly one Project: the oldest Newsletter first, or
-- the oldest Project when the workspace has not created a Newsletter yet.
UPDATE "newsletter_sending_domain" AS sending_domain
SET "projectId" = COALESCE(
  (
    SELECT newsletter."projectId"
    FROM "newsletter" AS newsletter
    JOIN "project" AS project ON project.id = newsletter."projectId"
    WHERE newsletter."workspaceId" = sending_domain."workspaceId"
      AND project."workspaceId" = sending_domain."workspaceId"
    ORDER BY newsletter."createdAt", newsletter.id
    LIMIT 1
  ),
  (
    SELECT project.id
    FROM "project" AS project
    WHERE project."workspaceId" = sending_domain."workspaceId"
    ORDER BY project."createdAt", project.id
    LIMIT 1
  )
);

ALTER TABLE "newsletter_sending_domain" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "newsletter_sending_domain" DROP CONSTRAINT "newsletter_sending_domain_workspaceId_fkey";
DROP INDEX "newsletter_sending_domain_workspaceId_key";
ALTER TABLE "newsletter_sending_domain" DROP COLUMN "workspaceId";

CREATE UNIQUE INDEX "newsletter_sending_domain_projectId_key" ON "newsletter_sending_domain"("projectId");
ALTER TABLE "newsletter_sending_domain" ADD CONSTRAINT "newsletter_sending_domain_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
