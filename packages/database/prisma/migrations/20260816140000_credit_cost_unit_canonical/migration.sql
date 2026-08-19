-- CreditCost.unit is a protocol identifier. Canonicalize the same ASCII
-- transport-whitespace set as normalizeMasumiPaymentUnit, then lowercase.
CREATE OR REPLACE FUNCTION "canonical_credit_cost_unit"(TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN BTRIM(
      $1,
      CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || CHR(32)
    ) = ''
      OR LOWER(BTRIM(
        $1,
        CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || CHR(32)
      )) = 'lovelace'
    THEN 'lovelace'
    ELSE LOWER(BTRIM(
      $1,
      CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || CHR(32)
    ))
  END
$$;

-- Install before preflight/backfill/CHECK. Old binaries may keep writing
-- uppercase or whitespace-padded units throughout a rolling deploy.
CREATE OR REPLACE FUNCTION "canonicalize_credit_cost_unit_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW."unit" := public."canonical_credit_cost_unit"(NEW."unit");
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "credit_cost_unit_canonical_write_trg"
ON "CreditCost";

CREATE TRIGGER "credit_cost_unit_canonical_write_trg"
BEFORE INSERT OR UPDATE OF "unit"
ON "CreditCost"
FOR EACH ROW
EXECUTE FUNCTION "canonicalize_credit_cost_unit_write"();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CreditCost"
    GROUP BY public."canonical_credit_cost_unit"("unit")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot canonicalize credit_cost units: normalized duplicates exist';
  END IF;
END
$$;

UPDATE "CreditCost"
SET "unit" = public."canonical_credit_cost_unit"("unit")
WHERE "unit" <> public."canonical_credit_cost_unit"("unit");

ALTER TABLE "CreditCost"
  ADD CONSTRAINT "credit_cost_unit_canonical_chk"
  CHECK ("unit" = public."canonical_credit_cost_unit"("unit"));
