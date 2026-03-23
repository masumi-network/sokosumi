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
      '{invoiceEmail}',
      to_jsonb("invoiceEmail"),
      true
    )::text
    ELSE jsonb_build_object('invoiceEmail', "invoiceEmail")::text
  END
)
WHERE "invoiceEmail" IS NOT NULL
  AND btrim("invoiceEmail") <> '';

DROP FUNCTION public.try_parse_jsonb(TEXT);

ALTER TABLE "public"."organization"
DROP COLUMN "invoiceEmail";
