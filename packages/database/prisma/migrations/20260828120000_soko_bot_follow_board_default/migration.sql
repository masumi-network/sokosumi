-- Watching only its own Tasks makes the assistant blind to most of the board
-- its owner works on, so following the whole board becomes the default.
ALTER TABLE "orchestrator" ALTER COLUMN "followWholeBoard" SET DEFAULT true;

-- Existing bots predate the setting being meaningful and nobody has opted out
-- deliberately yet, so bring them along rather than leaving a split fleet.
UPDATE "orchestrator" SET "followWholeBoard" = true WHERE "followWholeBoard" = false;
