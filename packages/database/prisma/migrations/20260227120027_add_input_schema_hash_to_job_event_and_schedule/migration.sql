-- Add input schema hash columns for job event and schedule
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "jobEvent"
ADD COLUMN "inputSchemaHash" TEXT;

ALTER TABLE "jobSchedule"
ADD COLUMN "inputSchemaHash" TEXT;

CREATE OR REPLACE FUNCTION _canonicalize_json_text(input_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  canonical_text TEXT;
BEGIN
  canonical_text := (input_text::jsonb)::text;
  RETURN canonical_text;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

UPDATE "jobEvent"
SET "inputSchemaHash" = encode(
  digest(convert_to(_canonicalize_json_text("inputSchema"), 'UTF8'), 'sha256'),
  'hex'
)
WHERE "inputSchema" IS NOT NULL;

UPDATE "jobSchedule"
SET "inputSchemaHash" = encode(
  digest(convert_to(_canonicalize_json_text("inputSchema"), 'UTF8'), 'sha256'),
  'hex'
)
WHERE "inputSchema" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "jobSchedule"
    WHERE "inputSchemaHash" IS NULL
  ) THEN
    RAISE EXCEPTION 'Backfill failed: jobSchedule.inputSchemaHash is NULL for one or more rows';
  END IF;
END;
$$;

ALTER TABLE "jobSchedule"
ALTER COLUMN "inputSchemaHash" SET NOT NULL;

DROP FUNCTION _canonicalize_json_text(TEXT);
