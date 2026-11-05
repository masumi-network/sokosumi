-- A contact is a person, or an organization or shared inbox.
CREATE TYPE "ContactKind" AS ENUM ('PERSON', 'ORGANIZATION');

ALTER TABLE "contact" ADD COLUMN "awaitingReplySince" TIMESTAMP(3),
ADD COLUMN "classifiedAt" TIMESTAMP(3),
ADD COLUMN "kind" "ContactKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN "lastInboundAt" TIMESTAMP(3),
ALTER COLUMN "stage" SET DEFAULT 'CONTACT';

ALTER TABLE "contact_list" ADD COLUMN "createdAutomatically" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "contact_list_member" ADD COLUMN "addedAutomatically" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "contact_workspaceId_awaitingReplySince_idx" ON "contact"("workspaceId", "awaitingReplySince");

-- Reply state from the interactions already logged: the latest touch from
-- them, and the first outreach since then that is still unanswered.
WITH inbound AS (
  SELECT "contactId", max("occurredAt") AS "at"
  FROM "contact_interaction"
  WHERE "direction" IN ('IN', 'BOTH')
  GROUP BY "contactId"
), waiting AS (
  SELECT i."contactId", min(i."occurredAt") AS "since"
  FROM "contact_interaction" i
  LEFT JOIN inbound ON inbound."contactId" = i."contactId"
  WHERE i."direction" = 'OUT'
    AND (inbound."at" IS NULL OR i."occurredAt" > inbound."at")
  GROUP BY i."contactId"
), reply AS (
  SELECT c."id", inbound."at", waiting."since"
  FROM "contact" c
  LEFT JOIN inbound ON inbound."contactId" = c."id"
  LEFT JOIN waiting ON waiting."contactId" = c."id"
  WHERE inbound."at" IS NOT NULL OR waiting."since" IS NOT NULL
)
UPDATE "contact" c
SET "lastInboundAt" = reply."at",
  "awaitingReplySince" = reply."since"
FROM reply
WHERE c."id" = reply."id";

-- Captured and imported people were filed as LEAD only because it was the
-- column default; nobody chose it, so they become plain contacts. A stage a
-- person or a bot changed (recorded in the history) stays.
UPDATE "contact" c
SET "stage" = 'CONTACT'
WHERE c."stage" = 'LEAD'
  AND NOT EXISTS (
    SELECT 1 FROM "contact_activity" a
    WHERE a."contactId" = c."id" AND a."changes" ? 'stage'
  )
  AND EXISTS (
    SELECT 1 FROM "contact_interaction" i
    WHERE i."contactId" = c."id"
      AND i."sourceRef" ~ '^(gmail|outlook|googlecalendar|slack|import):'
  );
