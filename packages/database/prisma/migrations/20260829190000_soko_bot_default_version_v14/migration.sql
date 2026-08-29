-- v14 is v13's autonomy with an honest cost model: hiring an Agent and
-- assigning a Task to a Coworker both spend the owner's credits, so both are
-- weighed before starting. v13 called delegation free while the runtime
-- withheld the hire, which pointed the bot's caution at the one path it could
-- not take and waved through the one it could.
--
-- Every bot on a built-in version moves, per the owner's request that v14 be
-- the default for existing assistants too. Bots pinned to an authored
-- (custom-written) version keep it: that pin is a deliberate choice rather
-- than an artefact of when the bot was created.
UPDATE "orchestrator"
SET "versionId" = 'v14'
WHERE "versionId" IS NULL
   OR "versionId" NOT IN (SELECT "slug" FROM "soko_bot_authored_version");

UPDATE "soko_bot_setting"
SET "defaultVersionId" = 'v14'
WHERE "id" = 'singleton'
  AND (
    "defaultVersionId" IS NULL
    OR "defaultVersionId" NOT IN (SELECT "slug" FROM "soko_bot_authored_version")
  );
