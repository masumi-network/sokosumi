-- Tell a recorded conversation apart from a delivered first message.
--
-- The session row is written before the first message is dispatched, so its
-- existence never proved delivery. A retry that read "the row is already
-- there" as "the message already went" silently dropped the message; a retry
-- that had no stable name for the intent started a second conversation and
-- said the same thing twice. Both are now decided from state, not from
-- whether this call happened to insert the row.
CREATE TYPE "ProjectImageInitialTurn" AS ENUM ('NONE', 'PENDING', 'DELIVERING', 'DELIVERED', 'UNCERTAIN');

ALTER TABLE "project_image_session"
  ADD COLUMN "clientIntentId"     TEXT,
  ADD COLUMN "initialTurn"        "ProjectImageInitialTurn" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "initialTurnLeaseAt" TIMESTAMP(3);

-- One intent, one conversation. Null intents stay distinct under Postgres NULL
-- semantics, which is exactly the "caller named no intent, so no dedupe" case.
CREATE UNIQUE INDEX "project_image_session_projectId_clientIntentId_key"
  ON "project_image_session" ("projectId", "clientIntentId");

-- Existing rows keep the default NONE, which is the true statement about them:
-- nothing is owed. Their first message, if they had one, was delivered by the
-- request that created them, so no backfill can or should claim otherwise.
