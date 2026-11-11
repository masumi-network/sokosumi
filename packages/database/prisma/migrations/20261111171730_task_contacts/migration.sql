-- Tasks can tag many contacts. Replaces the single "task"."contactId" link
-- from 20261111171729_task_contact and keeps the links it already holds.
--
-- Additive on purpose: the release before this one still reads and writes
-- "task"."contactId" until the new deployment activates (or after a
-- rollback). The column stays, and a trigger mirrors its writes into
-- "task_contact". A later migration drops both once no such release runs.

-- CreateTable
CREATE TABLE "task_contact" (
    "taskId" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_contact_pkey" PRIMARY KEY ("taskId","contactId")
);

-- CreateIndex
CREATE INDEX "task_contact_contactId_idx" ON "task_contact"("contactId");

-- AddForeignKey
ALTER TABLE "task_contact" ADD CONSTRAINT "task_contact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_contact" ADD CONSTRAINT "task_contact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mirror the previous release's single-contact writes: a new link tags the
-- contact, a changed or cleared link (merge, workspace move) untags the old one.
CREATE OR REPLACE FUNCTION "task_contact_from_legacy_link"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."contactId" IS NOT NULL THEN
    DELETE FROM "task_contact"
    WHERE "taskId" = OLD."id" AND "contactId" = OLD."contactId";
  END IF;
  IF NEW."contactId" IS NOT NULL THEN
    INSERT INTO "task_contact" ("taskId", "contactId")
    VALUES (NEW."id", NEW."contactId")
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_contact_from_legacy_link_trg"
AFTER INSERT OR UPDATE OF "contactId" ON "task"
FOR EACH ROW EXECUTE FUNCTION "task_contact_from_legacy_link"();

-- Copy the links that already exist
INSERT INTO "task_contact" ("taskId", "contactId")
SELECT "id", "contactId" FROM "task" WHERE "contactId" IS NOT NULL
ON CONFLICT DO NOTHING;
