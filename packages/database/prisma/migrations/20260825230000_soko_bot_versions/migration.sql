ALTER TABLE "orchestrator" RENAME COLUMN "presetId" TO "versionId";
ALTER TABLE "soko_bot_turn" RENAME COLUMN "presetId" TO "versionId";
-- Preset ids map onto the versions that replaced them.
UPDATE "orchestrator" SET "versionId" = CASE "versionId" WHEN 'large-3' THEN 'v1' WHEN 'medium-3.5' THEN 'v2' WHEN 'devstral-2' THEN 'v3' WHEN 'large-3-strict' THEN 'v4' ELSE "versionId" END;
UPDATE "soko_bot_turn" SET "versionId" = CASE "versionId" WHEN 'large-3' THEN 'v1' WHEN 'medium-3.5' THEN 'v2' WHEN 'devstral-2' THEN 'v3' WHEN 'large-3-strict' THEN 'v4' ELSE "versionId" END;
