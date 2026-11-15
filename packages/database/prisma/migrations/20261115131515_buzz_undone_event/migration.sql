-- Undone app-key reactions are remembered by event, not by tombstone links,
-- which one slot per message, person and emoji could not keep.
CREATE TABLE "buzz_undone_event" (
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buzz_undone_event_pkey" PRIMARY KEY ("eventId")
);

INSERT INTO "buzz_undone_event" ("eventId", "createdAt")
SELECT "eventId", "removedAt" FROM "buzz_reaction_link" WHERE "removedAt" IS NOT NULL;

DELETE FROM "buzz_reaction_link" WHERE "removedAt" IS NOT NULL;

ALTER TABLE "buzz_reaction_link" DROP COLUMN "removedAt";
