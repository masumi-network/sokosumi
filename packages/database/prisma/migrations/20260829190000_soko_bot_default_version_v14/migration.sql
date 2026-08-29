-- v14 is v13's autonomy with an honest cost model: hiring an Agent and
-- assigning a Task to a Coworker both spend the owner's credits, so both are
-- weighed before starting. v13 called delegation free while the runtime
-- withheld the hire, which pointed the bot's caution at the one path it could
-- not take and waved through the one it could.

-- Before this release "v14" was not a built-in, so an administrator could have
-- authored a version under that slug. Runtime resolves built-ins first, so
-- anything pinned to an authored "v14" would silently start running the
-- built-in: a different prompt, and a wider capability allowlist than the
-- author chose. Move the authored row out of the way and carry every pin with
-- it, so a deliberate configuration survives instead of being replaced.
--
-- The target slug is chosen at run time because "v14-authored" may itself
-- already exist; `slug` is unique, so a blind rename would abort the migration.
DO $$
DECLARE
  target TEXT;
  suffix INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "soko_bot_authored_version" WHERE "slug" = 'v14')
  THEN
    RETURN;
  END IF;

  LOOP
    target := CASE
      WHEN suffix = 0 THEN 'v14-authored'
      ELSE 'v14-authored-' || suffix
    END;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM "soko_bot_authored_version" WHERE "slug" = target
    );
    suffix := suffix + 1;
  END LOOP;

  UPDATE "soko_bot_authored_version" SET "slug" = target WHERE "slug" = 'v14';
  -- Every pin, not only the bot's: a turn interrupted mid-flight is resumed
  -- against its stored versionId, and lab runs and quality scores are compared
  -- by it, so leaving those behind would rerun and re-attribute work under a
  -- prompt and model its author never chose.
  UPDATE "orchestrator" SET "versionId" = target WHERE "versionId" = 'v14';
  UPDATE "soko_bot_turn" SET "versionId" = target WHERE "versionId" = 'v14';
  UPDATE "soko_bot_lab_run" SET "versionId" = target WHERE "versionId" = 'v14';
  UPDATE "soko_bot_setting"
  SET "defaultVersionId" = target
  WHERE "id" = 'singleton' AND "defaultVersionId" = 'v14';
END $$;

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
