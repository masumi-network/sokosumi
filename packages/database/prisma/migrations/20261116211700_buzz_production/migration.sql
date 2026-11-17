-- Communities created on a multi-community relay, and room history imported.
ALTER TABLE "buzz_community" ADD COLUMN "provisionedAt" TIMESTAMP(3);
ALTER TABLE "buzz_channel" ADD COLUMN "historyImportedAt" TIMESTAMP(3);

-- Communities that exist already (one-community relays) need no creating.
UPDATE "buzz_community" SET "provisionedAt" = "createdAt";
