-- Repairs databases that applied an earlier draft of
-- 20260829190000_soko_bot_default_version_v14.
--
-- `prisma migrate deploy` records a migration as applied and never reruns it,
-- so editing that file fixed nothing for Preview or any environment that had
-- already deployed it. Those databases may still carry pins to an authored
-- "v14" that the built-in now shadows, and turn and lab-run pins that the
-- first draft did not move at all.
--
-- Written to be a no-op wherever the corrected version already ran.
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
  UPDATE "orchestrator" SET "versionId" = target WHERE "versionId" = 'v14';
  UPDATE "soko_bot_turn" SET "versionId" = target WHERE "versionId" = 'v14';
  UPDATE "soko_bot_lab_run" SET "versionId" = target WHERE "versionId" = 'v14';
  UPDATE "soko_bot_setting"
  SET "defaultVersionId" = target
  WHERE "id" = 'singleton' AND "defaultVersionId" = 'v14';
END $$;

-- Bots the first draft left behind, and the promoted default.
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
