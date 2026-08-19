-- Better Auth 1.7: issuer-scoped accounts, Microsoft oid, OAuth client columns.
-- Fails closed if any account.issuer would stay null (run harvest first).

-- Account identity
ALTER TABLE "account" ADD COLUMN "issuer" TEXT;

UPDATE "account"
SET
  "issuer" = 'local:credential',
  "accountId" = "userId"
WHERE "providerId" = 'credential';

UPDATE "account"
SET "issuer" = 'https://accounts.google.com'
WHERE "providerId" = 'google';

UPDATE "account" AS a
SET
  "issuer" = payload.claims->>'iss',
  "accountId" = payload.claims->>'oid'
FROM (
  SELECT
    id,
    convert_from(
      decode(
        rpad(
          replace(replace(split_part("idToken", '.', 2), '-', '+'), '_', '/'),
          4 * ceil(
            length(
              replace(replace(split_part("idToken", '.', 2), '-', '+'), '_', '/')
            ) / 4.0
          )::int,
          '='
        ),
        'base64'
      ),
      'utf8'
    )::jsonb AS claims
  FROM "account"
  WHERE "providerId" = 'microsoft'
    AND "idToken" IS NOT NULL
    AND "idToken" <> ''
) AS payload
WHERE a.id = payload.id
  AND payload.claims->>'iss' LIKE 'https://login.microsoftonline.com/%'
  AND COALESCE(payload.claims->>'oid', '') <> '';

UPDATE "account"
SET "issuer" = 'local:oauth:' || replace(replace("providerId", '%', '%25'), '/', '%2F')
WHERE "issuer" IS NULL
  AND "providerId" NOT IN ('credential', 'google', 'microsoft');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "account" WHERE "issuer" IS NULL OR "issuer" = ''
  ) THEN
    RAISE EXCEPTION
      'account.issuer backfill incomplete; run pnpm data-migration:better-auth-1-7-harvest and retry';
  END IF;
END $$;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "issuer", "accountId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'account (issuer, accountId) collisions; inspect rows and stop — do not merge users by email';
  END IF;
END $$;

CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- OAuth client 1.7 columns
ALTER TABLE "oauthClient"
  ADD COLUMN "clientDiscoveryId" TEXT,
  ADD COLUMN "subjectType" TEXT,
  ADD COLUMN "clientCredentialsScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "backchannelLogoutUri" TEXT,
  ADD COLUMN "backchannelLogoutSessionRequired" BOOLEAN,
  ADD COLUMN "applicationType" TEXT,
  ADD COLUMN "jwks" TEXT,
  ADD COLUMN "jwksUri" TEXT,
  ADD COLUMN "dpopBoundAccessTokens" BOOLEAN NOT NULL DEFAULT false;

UPDATE "oauthClient"
SET "applicationType" = "type"
WHERE "type" IN ('web', 'native');

UPDATE "oauthClient"
SET "tokenEndpointAuthMethod" = 'none'
WHERE "public" IS TRUE
  AND ("tokenEndpointAuthMethod" IS NULL OR "tokenEndpointAuthMethod" = '');

UPDATE "oauthClient"
SET "tokenEndpointAuthMethod" = 'client_secret_basic'
WHERE "public" IS DISTINCT FROM TRUE
  AND "tokenEndpointAuthMethod" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "oauthClient"
    WHERE "type" IS NOT NULL
      AND "type" NOT IN ('web', 'native')
      AND "applicationType" IS NULL
  ) THEN
    RAISE EXCEPTION
      'oauthClient.type needs review before dropping type/public; map user-agent-based clients first';
  END IF;
END $$;

ALTER TABLE "oauthClient" DROP COLUMN "public";
ALTER TABLE "oauthClient" DROP COLUMN "type";

CREATE INDEX "oauthClient_userId_idx" ON "oauthClient"("userId");

-- Token / consent additive columns
ALTER TABLE "oauthAccessToken"
  ADD COLUMN "revoked" TIMESTAMP(3),
  ADD COLUMN "authorizationCodeId" TEXT,
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "confirmation" JSONB;

CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

ALTER TABLE "oauthRefreshToken"
  ADD COLUMN "authorizationCodeId" TEXT,
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "confirmation" JSONB,
  ADD COLUMN "rotatedAt" TIMESTAMP(3),
  ADD COLUMN "rotationReplayResponse" TEXT,
  ADD COLUMN "rotationReplayExpiresAt" TIMESTAMP(3);

CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

ALTER TABLE "oauthConsent"
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent"("userId");

-- Plugin tables 1.7 oauth-provider expects (empty until a resource is configured)
CREATE TABLE "oauthResource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauthResource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauthResource_identifier_key" ON "oauthResource"("identifier");

CREATE TABLE "oauthClientResource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_key"
  ON "oauthClientResource"("clientId", "resourceId");
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");

ALTER TABLE "oauthClientResource"
  ADD CONSTRAINT "oauthClientResource_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauthClientResource"
  ADD CONSTRAINT "oauthClientResource_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "oauthClientAssertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY ("id")
);

-- jwt plugin 1.7: createJwk writes alg/crv. Existing keys stay null (inherit EdDSA).
ALTER TABLE "jwks" ADD COLUMN "alg" TEXT;
ALTER TABLE "jwks" ADD COLUMN "crv" TEXT;
