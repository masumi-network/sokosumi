-- Clear legacy organization/user metadata.url values that fail Zod z.httpUrl()
-- (localhost, IPs, bare host labels, missing scheme). Write path now rejects
-- these; response schema stays strict so leftover junk would 500 org reads.

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

-- Hostname must look like a domain with a TLD (mirrors Zod domain regex for
-- ASCII/punycode hosts). Optional is optional; path/query/hash optional.
-- Does not accept localhost, bare labels, or raw IPs.

UPDATE "public"."organization" AS o
SET "metadata" = (
  CASE
    WHEN (j - 'url') = '{}'::jsonb THEN NULL
    ELSE (j - 'url')::text
  END
)
FROM (
  SELECT
    id,
    public.try_parse_jsonb("metadata") AS j
  FROM "public"."organization"
  WHERE "metadata" IS NOT NULL
    AND btrim("metadata") <> ''
) AS parsed
WHERE o.id = parsed.id
  AND parsed.j IS NOT NULL
  AND jsonb_typeof(parsed.j) = 'object'
  AND parsed.j ? 'url'
  AND (
    jsonb_typeof(parsed.j -> 'url') <> 'string'
    OR btrim(parsed.j ->> 'url') = ''
    OR NOT (
      btrim(parsed.j ->> 'url')
      ~* '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(:[0-9]+)?([/?#].*)?$'
    )
  );

UPDATE "public"."user" AS u
SET "metadata" = (
  CASE
    WHEN (j - 'url') = '{}'::jsonb THEN NULL
    ELSE (j - 'url')::text
  END
)
FROM (
  SELECT
    id,
    public.try_parse_jsonb("metadata") AS j
  FROM "public"."user"
  WHERE "metadata" IS NOT NULL
    AND btrim("metadata") <> ''
) AS parsed
WHERE u.id = parsed.id
  AND parsed.j IS NOT NULL
  AND jsonb_typeof(parsed.j) = 'object'
  AND parsed.j ? 'url'
  AND (
    jsonb_typeof(parsed.j -> 'url') <> 'string'
    OR btrim(parsed.j ->> 'url') = ''
    OR NOT (
      btrim(parsed.j ->> 'url')
      ~* '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(:[0-9]+)?([/?#].*)?$'
    )
  );

DROP FUNCTION public.try_parse_jsonb(TEXT);
