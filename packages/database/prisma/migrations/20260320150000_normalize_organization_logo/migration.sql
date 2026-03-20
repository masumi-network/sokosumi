/*
  Data migration: normalize organization.logo for API invariants (HTTPS or NULL).

  - Empty / whitespace-only -> NULL
  - Trim surrounding whitespace
  - ipfs://... -> NMKR gateway HTTPS URL
  - Bare IPFS CIDs (Qm..., bafy...) -> gateway URL
  - Any remaining value that is not an http(s) URL -> NULL
*/

UPDATE "organization"
SET "logo" = NULL
WHERE "logo" IS NOT NULL AND btrim("logo") = '';

UPDATE "organization"
SET "logo" = btrim("logo")
WHERE "logo" IS NOT NULL AND "logo" <> btrim("logo");

UPDATE "organization"
SET "logo" = replace("logo", 'ipfs://', 'https://c-ipfs-gw.nmkr.io/ipfs/')
WHERE "logo" LIKE 'ipfs://%';

UPDATE "organization"
SET "logo" = 'https://c-ipfs-gw.nmkr.io/ipfs/' || "logo"
WHERE "logo" IS NOT NULL
  AND "logo" NOT LIKE 'http://%'
  AND "logo" NOT LIKE 'https://%'
  AND ("logo" LIKE 'Qm%' OR "logo" LIKE 'bafy%');

UPDATE "organization"
SET "logo" = NULL
WHERE "logo" IS NOT NULL
  AND "logo" !~* '^https?://';
