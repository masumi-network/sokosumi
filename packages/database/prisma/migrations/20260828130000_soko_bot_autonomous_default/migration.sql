-- v13 is v11's model and region plus autonomy: self-started turns may start
-- work rather than only draft it, must weigh cost and ask when the work looks
-- expensive, and must report what they started in the owner's chat. Bots on
-- v11 move with the default, as they did when v1 was superseded.
UPDATE "orchestrator" SET "versionId" = 'v13' WHERE "versionId" = 'v11' OR "versionId" IS NULL;

UPDATE "soko_bot_setting" SET "defaultVersionId" = 'v13' WHERE "id" = 'singleton' AND ("defaultVersionId" = 'v11' OR "defaultVersionId" IS NULL);
