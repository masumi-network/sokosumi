-- How well each teammate knows a contact (familiarity, computed from their
-- own interactions) and how much it matters to them (importance, judged by
-- Jev or set by them or their Soko Bot).
CREATE TYPE "ContactImportanceSource" AS ENUM ('JEV', 'SOKO_BOT', 'MANUAL');

CREATE TABLE "contact_score" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "familiarity" INTEGER NOT NULL DEFAULT 0,
    "importance" INTEGER,
    "importanceSource" "ContactImportanceSource",
    "importanceReason" TEXT,
    "importanceJudgedAt" TIMESTAMP(3),
    "importanceJudgedAtCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_score_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_score_contactId_userId_key" ON "contact_score"("contactId", "userId");
CREATE INDEX "contact_score_workspaceId_userId_idx" ON "contact_score"("workspaceId", "userId");

ALTER TABLE "contact_score" ADD CONSTRAINT "contact_score_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_score" ADD CONSTRAINT "contact_score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Familiarity for every teammate who already has interactions; the same
-- formula as `refreshContactFamiliarity` in Core.
INSERT INTO "contact_score" ("id", "workspaceId", "contactId", "userId", "familiarity", "updatedAt")
SELECT gen_random_uuid(), i."workspaceId", i."contactId", i."userId",
  round(100 * (
      0.45 * least(1, ln(1 + count(*)) / ln(31))
    + 0.30 * least(1, 2.0 * count(*) FILTER (WHERE i."direction" IN ('IN', 'BOTH')) / count(*))
    + 0.25 * least(1, count(*) FILTER (WHERE i."channel" IN ('MEETING', 'CALL')) / 3.0)
  ) * (0.35 + 0.65 * exp(-greatest(0, extract(epoch FROM (now() - max(i."occurredAt")))) / 86400 / 180)))::int,
  now()
FROM "contact_interaction" i
JOIN "contact" c ON c."id" = i."contactId" AND c."mergedIntoId" IS NULL
WHERE i."userId" IS NOT NULL
GROUP BY i."workspaceId", i."contactId", i."userId";
