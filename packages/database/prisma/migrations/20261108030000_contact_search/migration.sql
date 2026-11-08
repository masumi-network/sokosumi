-- Audience per channel (X followers today).
ALTER TABLE "contact_channel" ADD COLUMN "followers" INTEGER;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "contact_search" (
    "contactId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "document" TEXT NOT NULL,
    "search_vector" tsvector,
    "embedding" vector(768),
    "embeddedHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_search_pkey" PRIMARY KEY ("contactId")
);

CREATE INDEX "contact_search_workspaceId_idx" ON "contact_search"("workspaceId");
CREATE INDEX "contact_search_search_vector_idx" ON "contact_search" USING GIN ("search_vector");

ALTER TABLE "contact_search" ADD CONSTRAINT "contact_search_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only objects Prisma cannot express, mirrored by the comment on
-- ContactSearch in contact.prisma.

-- Typo-tolerant and partial matches over the whole document.
CREATE INDEX "contact_search_document_trgm_idx" ON "contact_search" USING GIN ("document" gin_trgm_ops);

-- Rebuilds one contact's document. 'simple' keeps tokens unstemmed, so
-- English, German and Spanish share one predictable index. Channel values
-- are also split at @ . / : _ - so "acme" finds nina@acme.com.
CREATE FUNCTION contact_search_refresh(target UUID) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "contact_search" ("contactId", "workspaceId", "document", "search_vector", "updatedAt")
  SELECT c."id", c."workspaceId", d.document, to_tsvector('simple', d.document), CURRENT_TIMESTAMP
  FROM "contact" c
  CROSS JOIN LATERAL (
    SELECT lower(unaccent(concat_ws(E'\n',
      c."name", c."organization", c."role", c."location",
      lower(c."stage"::text),
      CASE WHEN c."kind" = 'ORGANIZATION' THEN 'organization company' END,
      c."summary", c."whyInteresting", c."nextStep",
      (SELECT string_agg(ch."value" || ' ' || regexp_replace(ch."value", '[@./:_-]+', ' ', 'g'), ' ')
         FROM "contact_channel" ch WHERE ch."contactId" = c."id")
    ))) AS document
  ) d
  WHERE c."id" = target
  ON CONFLICT ("contactId") DO UPDATE
    SET "document" = EXCLUDED."document",
        "search_vector" = EXCLUDED."search_vector",
        "updatedAt" = EXCLUDED."updatedAt"
    WHERE "contact_search"."document" IS DISTINCT FROM EXCLUDED."document";
END;
$$;

CREATE FUNCTION contact_search_on_contact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM contact_search_refresh(NEW."id");
  RETURN NULL;
END;
$$;

-- Channel changes refresh each touched contact once per statement (a merge
-- moves many channels in one), and only for changes the document shows.
CREATE FUNCTION contact_search_on_channel_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM contact_search_refresh(id)
  FROM (SELECT DISTINCT "contactId" AS id FROM new_rows) touched;
  RETURN NULL;
END;
$$;

CREATE FUNCTION contact_search_on_channel_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM contact_search_refresh(id)
  FROM (SELECT DISTINCT "contactId" AS id FROM old_rows) touched;
  RETURN NULL;
END;
$$;

CREATE FUNCTION contact_search_on_channel_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM contact_search_refresh(id)
  FROM (
    SELECT o."contactId" AS id FROM old_rows o JOIN new_rows n USING ("id")
    WHERE o."contactId" <> n."contactId" OR o."value" <> n."value"
    UNION
    SELECT n."contactId" FROM old_rows o JOIN new_rows n USING ("id")
    WHERE o."contactId" <> n."contactId" OR o."value" <> n."value"
  ) touched;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "contact_search_contact"
  AFTER INSERT OR UPDATE OF "name", "organization", "role", "location", "summary", "whyInteresting", "nextStep", "stage", "kind"
  ON "contact" FOR EACH ROW EXECUTE FUNCTION contact_search_on_contact();

CREATE TRIGGER "contact_search_channel_insert"
  AFTER INSERT ON "contact_channel" REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION contact_search_on_channel_insert();

CREATE TRIGGER "contact_search_channel_delete"
  AFTER DELETE ON "contact_channel" REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION contact_search_on_channel_delete();

CREATE TRIGGER "contact_search_channel_update"
  AFTER UPDATE ON "contact_channel" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION contact_search_on_channel_update();

-- Every existing contact.
SELECT contact_search_refresh("id") FROM "contact";
