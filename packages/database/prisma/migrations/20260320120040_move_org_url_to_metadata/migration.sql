CREATE OR REPLACE FUNCTION public.try_parse_jsonb(value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

UPDATE "public"."organization"
SET "metadata" = (
  CASE
    WHEN public.try_parse_jsonb("metadata") IS NOT NULL
      AND jsonb_typeof(public.try_parse_jsonb("metadata")) = 'object'
    THEN jsonb_set(
      public.try_parse_jsonb("metadata"),
      '{url}',
      to_jsonb("url"),
      true
    )::text
    ELSE jsonb_build_object('url', "url")::text
  END
)
WHERE "url" IS NOT NULL
  AND btrim("url") <> '';

DROP FUNCTION public.try_parse_jsonb(TEXT);

ALTER TABLE "public"."organization"
DROP COLUMN "url";
