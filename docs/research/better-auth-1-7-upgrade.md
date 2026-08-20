# Better Auth 1.6.x → 1.7.0 upgrade research

Researched 2026-08-18 against **primary sources only**. Claims below are quoted or paraphrased from those sources and cited. Nothing here is an implementation plan.

**This repo today:** `better-auth` and every `@better-auth/*` app dependency is pinned at **1.6.29** (`apps/core/package.json`, `apps/web/package.json`). `@better-auth/utils` is **0.4.2**. Auth lives on Core (Hono) with `@better-auth/prisma-adapter`, organization, Stripe, oauth-provider, passkey, api-key, i18n, jwt, magic-link, admin, last-login-method, oAuthProxy. Web is Next.js App Router consuming Better Auth clients.

## Sources

| Source | URL |
| --- | --- |
| Official 1.7 upgrade guide | https://better-auth.com/docs/guides/1-7-upgrade-guide |
| 1.7 announcement | https://better-auth.com/blog/1-7 |
| 1.7 RC notes (labels + extra callouts) | https://github.com/better-auth/better-auth/discussions/10250 |
| GitHub release `v1.7.0` | https://github.com/better-auth/better-auth/releases/tag/v1.7.0 |
| `better-auth` changelog at `v1.7.0` | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/better-auth/CHANGELOG.md |
| `@better-auth/oauth-provider` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/oauth-provider/CHANGELOG.md |
| `@better-auth/stripe` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/stripe/CHANGELOG.md |
| `@better-auth/passkey` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/passkey/CHANGELOG.md |
| `@better-auth/sso` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/sso/CHANGELOG.md |
| `@better-auth/expo` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/expo/CHANGELOG.md |
| CLI (`auth`) changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/cli/CHANGELOG.md |
| `@better-auth/i18n` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/i18n/CHANGELOG.md |
| `@better-auth/prisma-adapter` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/prisma-adapter/CHANGELOG.md |
| `@better-auth/api-key` changelog | https://github.com/better-auth/better-auth/blob/v1.7.0/packages/api-key/CHANGELOG.md |
| npm `better-auth@1.7.0` | https://www.npmjs.com/package/better-auth/v/1.7.0 |
| npm CLI package `auth@1.7.0` | https://www.npmjs.com/package/auth |
| Official docs site | https://better-auth.com/docs |

The docs site header still showed **“v1.6 (Latest)”** when this was fetched, even though `v1.7.0` is published on GitHub/npm (released 18 Aug 00:23 UTC). Treat the upgrade guide + `v1.7.0` tag as the source of truth, not the site chrome.

---

## 1. How to upgrade (official order)

Upgrade guide: “Most Better Auth 1.7 changes are additive. Most projects start with one command: `npx auth upgrade`.” Then: “Upgrade `better-auth` and every `@better-auth/*` package together so the CLI and the library stay on 1.7.”

[https://better-auth.com/docs/guides/1-7-upgrade-guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)

**Required order** (quoted):

1. Complete manual preparation in Account identity, OAuth client records, SCIM, and Device Authorization when those sections apply.
2. Apply the 1.7 schema. With the built-in Kysely adapter, run `npx auth migrate`. **With Drizzle, Prisma, or a custom schema workflow, run `npx auth generate`, review the output, and apply it with your migration tooling.**
3. Deploy the 1.7 packages and configuration changes together.
4. Complete any post-deployment work, including SCIM reprovisioning.

The CLI “adds tables, columns, and indexes, but it does not choose issuers, copy OAuth clients, or convert legacy SCIM data.”

**CLI runtime:** “The `auth` CLI now requires Node.js 22.12 or newer.” Same statement in the `auth` package changelog ([#10170](https://github.com/better-auth/better-auth/pull/10170)). This repo already requires Node 24.x.

**Do not use `@better-auth/cli` for 1.7.** npm `auth@1.7.0` is “The CLI for Better Auth.” `@better-auth/cli` latest stable is **1.4.22** (no 1.7 line). The upgrade guide uses `npx auth …`; one oauth-provider changelog line still says `npx @better-auth/cli generate` — that is leftover wording. Use `npx auth generate` / `npx auth@1.7.0 generate`.

---

## 2. Packages that must move together

`better-auth@1.7.0` npm dependencies pin these to **1.7.0**:

- `@better-auth/core`
- `@better-auth/telemetry`
- `@better-auth/prisma-adapter`
- `@better-auth/drizzle-adapter`
- `@better-auth/kysely-adapter`
- `@better-auth/mongo-adapter`
- `@better-auth/memory-adapter`

Also published at **1.7.0** (same monorepo release; bump any you already depend on):

| Package | 1.7.0? | Notes |
| --- | --- | --- |
| `better-auth` | 1.7.0 | Core library |
| `auth` (CLI) | 1.7.0 | **This** is the 1.7 CLI. Node ≥ 22.12 |
| `@better-auth/stripe` | 1.7.0 | Used here |
| `@better-auth/passkey` | 1.7.0 | Used here |
| `@better-auth/oauth-provider` | 1.7.0 | Used here |
| `@better-auth/api-key` | 1.7.0 | Used here; no 1.7.0-specific breaking notes |
| `@better-auth/i18n` | 1.7.0 | Used here; additive translations only |
| `@better-auth/prisma-adapter` | 1.7.0 | Used here; empty 1.7.0 notes (version lockstep) |
| `@better-auth/expo` | 1.7.0 | Not used here |
| `@better-auth/sso` | 1.7.0 | Not used here |
| `@better-auth/mcp` | 1.7.0 | **New** package in 1.7 |
| `@better-auth/cimd` | 1.7.0 | **New**; required if adopting MCP CIMD |
| `@better-auth/scim` | 1.7.0 | Not used here |
| `@better-auth/electron` | 1.7.0 | Not used here |

**Do not assume these share the 1.7.0 number:**

| Package | Published latest (2026-08-18) | What 1.7.0 actually uses |
| --- | --- | --- |
| `@better-auth/cli` | **1.4.22** (abandoned for 1.7) | Use npm package **`auth@1.7.0`** |
| `@better-auth/utils` | **0.5.0** | `better-auth@1.7.0` still depends on **`@better-auth/utils@0.4.2`** (this repo already has 0.4.2). Do **not** treat 0.5.0 as part of the 1.7 lockstep |

This repo also uses the standalone `stripe` SDK (`22.5.0`). Official 1.7 notes do not require bumping that.

---

## 3. MUST-DO for any 1.6 → 1.7 upgrade

These apply even if you use only email/password + one social provider + Prisma.

### 3.1 Bump every Better Auth package together

Quoted: “Upgrade `better-auth` and every `@better-auth/*` package together so the CLI and the library stay on 1.7.”

[https://better-auth.com/docs/guides/1-7-upgrade-guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)

### 3.2 Account identity: add `Account.issuer` + unique `(issuer, accountId)` (manual backfill)

This is the biggest universal schema + data migration.

Upgrade guide: “Better Auth now recognizes an external account by the unique pair of `issuer` and `accountId`. The `providerId` remains the local provider configuration, while `account.id` identifies the Better Auth account row and `account.accountId` remains the stable identifier assigned by the provider. The account schema adds the required `issuer` field and creates a unique compound index across both identity fields without renaming `accountId`.”

Release notes: “This release requires `Account.issuer` but preserves `Account.accountId` as the provider-assigned account identifier.”

**Important RC revert:** 1.7.0-rc.2 briefly renamed `Account.accountId` → `Account.providerAccountId`. **Stable 1.7.0 kept `accountId`.** Do not apply the RC.2 rename.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer)
[https://github.com/better-auth/better-auth/releases/tag/v1.7.0](https://github.com/better-auth/better-auth/releases/tag/v1.7.0)

**Must do, quoted:**

- “Use a maintenance window and stop authentication writes before changing the account schema. The generated migration cannot choose trusted issuers or resolve identity collisions for you.”
- Back up `account` and `user`.
- Add `issuer` as **nullable** first. Keep existing `accountId`.
- Populate:

  | Account type | `issuer` | `accountId` |
  | --- | --- | --- |
  | Credential | `local:credential` | Stable id from the linked user row |
  | Provider with an issuer | Exact trusted issuer used by the provider | Existing provider account identifier |
  | OAuth provider without an issuer | `local:oauth:<encoded providerId>` | Existing provider account identifier |

- Synthetic issuer “percent-encodes its provider ID segment exactly as `encodeURIComponent(providerId)`”; e.g. `local:oauth:github`, `local:oauth:team%2Fgithub`.
- “Multiple provider configurations that represent the same OpenID Connect authority must use the same issuer. Do not derive an issuer from email, display name, an unverified request value, or a mutable authorization endpoint.”
- Collision check before the unique index:

  ```sql
  SELECT issuer, accountId, COUNT(*) AS accountCount, COUNT(DISTINCT userId) AS userCount
  FROM account
  GROUP BY issuer, accountId
  HAVING COUNT(*) > 1;
  ```

- “If duplicate rows belong to one user, choose the account record to keep… If a key belongs to multiple users, stop the migration and establish the owner from trusted provider data. Never merge users by matching email alone.”
- Then make `issuer` non-nullable and add the unique compound index.
- “Update custom adapters, database hooks, and generated schemas to include `issuer`.”

This repo’s Prisma `Account` model (`packages/database/prisma/schema.prisma`) has **no `issuer`** and no unique `(issuer, accountId)` today.

### 3.3 Microsoft accounts: migrate `sub` → `oid` during the same backfill

If you have `providerId: "microsoft"` (this repo does: `socialProviders.microsoft` in `apps/core/src/lib/auth.ts`):

Quoted: “Microsoft accounts now use the stable directory `oid` claim instead of the pairwise, app-specific `sub` claim. Complete this during step 3 of the account identity backfill, before checking for collisions or adding the compound account index.”

Changelog: “Existing Microsoft account rows created from `sub` must be migrated before upgrading.” “Tokens without a valid `oid` are rejected.”

[https://better-auth.com/docs/guides/1-7-upgrade-guide#migrate-microsoft-account-identifiers](https://better-auth.com/docs/guides/1-7-upgrade-guide#migrate-microsoft-account-identifiers)
[https://github.com/better-auth/better-auth/blob/v1.7.0/packages/better-auth/CHANGELOG.md](https://github.com/better-auth/better-auth/blob/v1.7.0/packages/better-auth/CHANGELOG.md) ([#10204](https://github.com/better-auth/better-auth/pull/10204))

If stored ID tokens are unavailable: “pause Microsoft sign-in and account linking during the cutover and obtain the mapping from a trusted Microsoft Entra export. Better Auth cannot derive `oid` from the old account row alone; accepting traffic before the migration can create duplicate accounts.”

`mapProfileToUser` “cannot override this provider-owned account identifier.”

### 3.4 Account API selectors changed — `providerId` is no longer a selector

Quoted: “Remove `providerId` from every account selector. The selector's `accountId` value is the local `account.id`, not the provider-side `account.accountId`.”

Supported shapes:

- `{ accountId: account.id, userId? }` — local row
- `{ useAccountCookie: true, userId? }` — signed account cookie

“A token or provider-profile request that previously omitted the selector to use the account cookie must now send `useAccountCookie: true`; omitting both supported selectors is invalid.”

`unlinkAccount` now takes the **local** `account.id` (from `listAccounts`), not `providerId`.

**This repo is affected:** `apps/web/src/app/(app)/connections/components/disconnect-modal.tsx` calls `authClient.unlinkAccount({ providerId })`. That call shape is invalid in 1.7.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer)

### 3.5 Identity / profile mapping rules

Quoted from the same account-identity section and changelog [#10403](https://github.com/better-auth/better-auth/pull/10403):

- OpenID Connect discovery uses verified `sub`; plain OAuth uses `id`; “the previous runtime fallback between those fields is removed.”
- Set `accountSubject` when either default is not the provider's immutable identifier.
- “`getUserInfo().user` now contains only mutable local-user fields; keep the provider identifier in `getUserInfo().data`.”
- “`mapProfileToUser` can no longer return `id`.”
- “The `accountInfo` response exposes the selected identity as `account.accountId` instead of `user.id`.”

This repo’s live `mapProfileToUser` is in `apps/core/src/lib/auth.ts` (Google and Microsoft share it). It returns `{ name, image, emailVerified: true }` and does not return `id` — already compatible with the 1.7 identity rule.

### 3.6 Move `experimental.joins` → `advanced.database.joins`

Quoted: “Database joins have moved out of `experimental` into a stable option at `advanced.database.joins` (default: `false`). If you previously set `experimental: { joins: true }`, update your config to:”

```ts
advanced: {
  database: {
    joins: true,
  },
}
```

“Drizzle and Prisma users should ensure their schema includes the required relations (`npx auth@latest generate`).”

**This repo is affected:** `apps/core/src/lib/auth.ts` has `experimental: { joins: true }` and a test asserting `config.experimental.joins === true`.

[https://github.com/better-auth/better-auth/releases/tag/v1.7.0](https://github.com/better-auth/better-auth/releases/tag/v1.7.0) ([#10359](https://github.com/better-auth/better-auth/pull/10359))

### 3.7 Generate + apply Prisma schema (do not use `auth migrate`)

Upgrade guide: Prisma users must `npx auth generate`, review, then apply with their own tooling.

This will add at least:

- `Account.issuer` + unique `(issuer, accountId)` (after your backfill)
- Prisma relations required for joins
- Any plugin tables/columns enabled in config (oauth-provider extras below)

`@better-auth/prisma-adapter@1.7.0` itself has **no additional breaking notes** in its changelog.

### 3.8 OAuth callback error code rename (if you parse it)

Quoted: “The OAuth callback redirect error value `email_doesn't_match` is renamed `email_does_not_match`.”

[https://better-auth.com/docs/guides/1-7-upgrade-guide#oauth-callback-error-code-renamed](https://better-auth.com/docs/guides/1-7-upgrade-guide#oauth-callback-error-code-renamed)

### 3.9 `generateState()` signature (only if you call it)

Quoted: replace `generateState(c, link, additionalData)` with `generateState(c, options)`.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#generatestate-signature-changed](https://better-auth.com/docs/guides/1-7-upgrade-guide#generatestate-signature-changed)

### 3.10 `oidcProvider` plugin removed

Quoted: “Replace `oidcProvider` from `better-auth/plugins` with `oauthProvider` from `@better-auth/oauth-provider`.”

This repo already uses `@better-auth/oauth-provider`. No action unless leftover imports exist.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#the-old-oidcprovider-plugin-is-removed](https://better-auth.com/docs/guides/1-7-upgrade-guide#the-old-oidcprovider-plugin-is-removed)

---

## 4. MUST-DO if you use the feature (conditional)

### 4.1 Behind a proxy / dynamic `baseURL` — forwarded headers untrusted by default

Quoted: “The dynamic `baseURL` config now ignores `x-forwarded-host` and `x-forwarded-proto` unless you set `advanced.trustedProxyHeaders: true`.”

“**Breaking change:** if your proxy exposes the public hostname only through `x-forwarded-host`, set `advanced.trustedProxyHeaders: true`. Deployments where the proxy rewrites `Host` to the public hostname (nginx default, Vercel, Cloudflare, and Netlify) are unaffected.”

This only applies when `baseURL: { allowedHosts: [...] }`. This repo uses a **string** `baseURL: betterAuthBaseUrl`, plus Vercel — likely unaffected, but confirm Core is not resolving origin from `x-forwarded-host` today.

[https://better-auth.com/docs/guides/1-7-upgrade-guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) (section “Behind a proxy”)
[https://github.com/better-auth/better-auth/blob/v1.7.0/packages/better-auth/CHANGELOG.md](https://github.com/better-auth/better-auth/blob/v1.7.0/packages/better-auth/CHANGELOG.md) ([#9134](https://github.com/better-auth/better-auth/pull/9134))

### 4.2 Generic OAuth plugin (not this repo)

If you used `genericOAuth` / `genericOAuthClient`:

- `signIn.oauth2({ providerId })` → `signIn.social({ provider })`
- `oauth2.link()` → `linkSocial()`
- Callback `/api/auth/oauth2/callback/:id` → `/api/auth/callback/:id`
- Remove `genericOAuthClient()`
- `pkce` defaults to **`true`** (was `false`)
- `authorizationUrlParams` / `tokenUrlParams` only accept `Record<string, string>`
- `issuer` and `requireIssuerValidation` **removed**
- Discovery providers now verify `id_token`; failed verification is rejected

This repo uses built-in `socialProviders.google` / `microsoft`, not the generic plugin.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#generic-oauth-is-rebuilt-on-the-social-provider-path](https://better-auth.com/docs/guides/1-7-upgrade-guide#generic-oauth-is-rebuilt-on-the-social-provider-path)

### 4.3 Google One Tap

Quoted: “Set `clientId` on `oneTap()` or configure the Google social provider with a client ID. One Tap now binds accounts to the verified Google subject instead of matching by email.”

Not used here.

### 4.4 Electron

S256 PKCE required; `disableOriginOverride` removed; upgrade `@better-auth/electron` client + server together; host-bearing custom-scheme `trustedOrigins` now match exactly.

Not used here.

### 4.5 Expo / React Native

Quoted: “`authClient.getCookie()` returns a promise.” Custom storage must provide `getItem`, `getItemAsync`, `setItem`, `setItemAsync`. `storageAdapter.setItem()` is synchronous; use `setItemAsync()` when the caller must wait.

Not used here.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#expo-and-react-native](https://better-auth.com/docs/guides/1-7-upgrade-guide#expo-and-react-native)

### 4.6 SIWE

Remove wallet address / chain from `siwe.nonce()` / `getNonce()`. Server `getNonce` must return an ERC-4361 nonce (8–250 alphanumeric).

Not used here.

### 4.7 Identity-token verifier / custom providers

Custom providers replace `verifyIdToken` method with `idToken` config. PayPal no longer accepts identity-token login.

Synchronous OAuth2 builders removed: `createAuthorizationCodeRequest`, `createRefreshAccessTokenRequest`, `createClientCredentialsTokenRequest` → async `authorizationCodeRequest`, `refreshAccessTokenRequest`, `clientCredentialsTokenRequest`.

JWKS client metadata must be `{ keys: [...] }`, not a bare array.

### 4.8 `@better-auth/oauth-provider` (this repo uses it)

This is the other large MUST-DO for Sokosumi.

#### 4.8.1 Remove `silenceWarnings`

Quoted: “Removed the `silenceWarnings` option from the oauth-provider plugin. … Delete any `silenceWarnings` entries from your oauthProvider config.”

**This repo is affected:** `apps/core/src/lib/auth.ts` sets `silenceWarnings: { oauthAuthServerConfig: true }`.

[https://github.com/better-auth/better-auth/blob/v1.7.0/packages/oauth-provider/CHANGELOG.md](https://github.com/better-auth/better-auth/blob/v1.7.0/packages/oauth-provider/CHANGELOG.md) ([#10703](https://github.com/better-auth/better-auth/pull/10703))

#### 4.8.2 Migrate OAuth client rows (manual)

If already on `@better-auth/oauth-provider` (this repo):

1. Add nullable `applicationType`, `clientDiscoveryId`, `clientCredentialsScopes`.
2. Map existing `web` / `native` client types to `applicationType`. Review user-agent-based clients. “Set `tokenEndpointAuthMethod` to `none` only for public clients; every other method is confidential.”
3. “Set `clientCredentialsScopes` to an empty array, then assign approved machine scopes to each client that uses the `client_credentials` grant. Remove `clientCredentialGrantDefaultScopes` from the provider configuration.”
4. Deduplicate `oauthClientResource` rows for the same `(clientId, resourceId)` before the new unique index.
5. “Drop the removed `type` and `public` columns after the backfill.”

This repo’s Prisma `OauthClient` still has `public` and `type` (`packages/database/prisma/schema.prisma`).

Replace `jwks: [key]` with `jwks: { keys: [key] }`.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#migrate-oauth-client-records](https://better-auth.com/docs/guides/1-7-upgrade-guide#migrate-oauth-client-records)

#### 4.8.3 `validAudiences` removed → `resources`

Quoted: “`validAudiences` is removed. Move each existing resource identifier into `resources`; link clients that should be limited to specific resources through `oauthClientResource` or Dynamic Client Registration `resources`.”

“Refresh-token TTLs now use the shortest applicable lifetime.” A per-resource `refreshTokenTtl` longer than `refreshTokenExpiresIn` is capped at the provider default.

This repo’s `oauthProvider({ ... })` does **not** set `validAudiences` today. Confirm no hidden default audience list after generate.

Schema adds `oauthResource`, `oauthClientResource`, and nullable `jwks.alg` / `jwks.crv`.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#protected-resources-replace-the-audience-list](https://better-auth.com/docs/guides/1-7-upgrade-guide#protected-resources-replace-the-audience-list)

#### 4.8.4 Sign-out revokes session-bound tokens (behavior + schema)

Quoted: “Introspection of an opaque or JWT access token whose bound session has ended now returns `{ active: false }`, and `/oauth2/userinfo` rejects it with `invalid_token`. Previously the token stayed active until its own TTL. If you relied on access tokens outliving the user's session, that no longer holds.”

“Refresh tokens without `offline_access` are revoked on session end; `offline_access` refresh tokens are preserved.”

Schema:

- `oauthClient.backchannelLogoutUri: string | null`
- `oauthClient.backchannelLogoutSessionRequired: boolean`
- `oauthAccessToken.revoked: Date | null`

On serverless: set `advanced.backgroundTasks.handler` so logout POSTs do not block sign-out.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#sign-out-revokes-session-tokens](https://better-auth.com/docs/guides/1-7-upgrade-guide#sign-out-revokes-session-tokens)

#### 4.8.5 DPoP renames the token verifier

Quoted: “The plain token-checking helper `verifyAccessToken` is renamed `verifyBearerToken` and now rejects DPoP tokens. Use the new `verifyAccessTokenRequest` on endpoints that may receive DPoP requests.”

Schema if enabling DPoP: `confirmation` on access-token and refresh-token tables.

**Proxy bite:** “Native DPoP checks the proof's `htu` claim against the URL the token endpoint computes for itself. Behind a TLS-terminating proxy or a custom server, that computed URL can be the internal bind address (`http://0.0.0.0:3000`)… Canonicalize the incoming request's scheme and host to your configured `baseURL` at the route boundary before the provider reads it.”

This is a Hono/Core deployment trap if DPoP is turned on.

#### 4.8.6 Other oauth-provider MUST-DOs if you hit the API

| Change | What to do | Source |
| --- | --- | --- |
| Protected-op `scopes` → `requiredScopes`; `challengeScopes` for WWW-Authenticate | Rename | Upgrade guide |
| `customAccessTokenClaims` now receives `resources: string[]` not `resource: string` | Update callbacks | [#9836](https://github.com/better-auth/better-auth/pull/9836) |
| Custom ID-token claims cannot set reserved protocol claims (`iss`, `sub`, `aud`, `exp`, `nonce`, `auth_time`, `acr`, `amr`, `azp`, …) | Move to namespaced claims | Upgrade guide |
| ID tokens no longer carry profile/email scope claims on authorization-code flow | Read UserInfo | Upgrade guide |
| `/oauth2/revoke` of a still-valid JWT access token → `400 unsupported_token_type` | Revoke refresh/opaque, or end the session | Upgrade guide |
| `max_age` now enforced | Clients that sent it as a no-op will re-prompt | Upgrade guide |
| Client create returns **201** not 200 | Update clients | Upgrade guide |
| Unauthenticated DCR no longer forces public; omit `token_endpoint_auth_method` → confidential `client_secret_basic` | Register `none` explicitly for public | Upgrade guide |
| Confidential clients must use their registered `token_endpoint_auth_method` | Match method; helpers default to body auth | Upgrade guide |
| `response_types` / `grant_types` must be reciprocal | Fix registrations | Upgrade guide |
| OAuth endpoints return RFC `{ error, error_description }` | Update parsers | Upgrade guide |
| UserInfo: token in header **or** body, not both | Fix clients | Upgrade guide |
| Server-side OAuth requests refuse redirects | Point at final URLs | Upgrade guide |
| `/oauth2/end-session` accepts POST; missing/invalid hint may show confirmation page | Update browser flows/tests | Upgrade guide |
| `jwt.sign` alg must match `keyPairConfig.alg` | Align | Upgrade guide |

This repo’s `oauthProvider` grant types are `authorization_code` + `refresh_token` only (no `client_credentials`). `clientRegistrationDefaultScopes` / `clientRegistrationAllowedScopes` already exist and should be reviewed against the new “capabilities a client may request, not user consent” wording.

### 4.9 MCP

MCP moves from `better-auth` to `@better-auth/mcp` + `@better-auth/oauth-provider` + `@better-auth/cimd`. `jwt()` required. `withMcpAuth` → `requireMcpAuth`. `mcpHandler` → `createMcpProtectedRequestHandler`. Endpoints `/mcp/*` → `/oauth2/*`. `oauthApplication` → `oauthClient`. Explicit `resource` required. Stateless POST-only MCP 2026-07-28 transport.

Not used here.

### 4.10 Stripe

Upgrade guide:

1. “`referenceMiddleware` now rejects organization-scoped subscriptions unless `organization: { enabled: true }` is set in the Stripe plugin config.” Organization plugin is still required separately.

2. “`onSubscriptionCancel` callback's `event` parameter is now required.” Changelog: “Update your callback to declare `event` as a required parameter and remove any `undefined` guards around it.”

This repo already sets `organization: { enabled: true }` and does **not** define `onSubscriptionCancel` — no action unless you add that callback.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#stripe](https://better-auth.com/docs/guides/1-7-upgrade-guide#stripe)
[https://github.com/better-auth/better-auth/blob/v1.7.0/packages/stripe/CHANGELOG.md](https://github.com/better-auth/better-auth/blob/v1.7.0/packages/stripe/CHANGELOG.md)

### 4.11 Organization plugin

- New optional `organization.getOrganization()` (metadata only). Feature, not required.
- `listUserTeams` can take `userId` / `organizationId`. Feature.
- Schema table: “Organization team counters — `team.memberCount` and `teamMember.membershipKey` columns. Manual preparation? **No**.”

This repo has **no** Prisma `Team` / `TeamMember` models. Counters only appear if you enable organization teams. No MUST-DO unless you turn teams on and then run generate.

SCIM was decoupled from organization ([#10390](https://github.com/better-auth/better-auth/pull/10390)). Irrelevant here (no SCIM).

### 4.12 Two-factor

`enableTwoFactor` now takes `method: "otp" | "totp"` (default `"totp"`) and returns a **discriminated** `{ method }` response.

Quoted: “**Response shape changed**: `enableTwoFactor` includes a `method` field in the response (`"otp"` or `"totp"`).”

Not used here.

RC discussion also listed “Two-factor account lockout adds schema fields” and “Two-factor challenges cap wrong codes” as 1.7 items. Those sentences appear in [discussion #10250](https://github.com/better-auth/better-auth/discussions/10250). The stable 1.7.0 `better-auth` changelog does **not** spell out lockout columns. If you enable 2FA, run `npx auth generate` and treat extra 2FA columns as required if they appear. **Unclear in the stable changelog — do not invent column names.**

### 4.13 Magic link / email OTP (this repo uses magic link)

Upgrade guide: “Magic-link and email-OTP sign-in can clear unproven linked accounts. Magic-link and email-OTP sign-in treat proven mailbox control as the source of truth…”

The HTML fetch of this section was truncated. Treat as a **behavior** change: a magic-link sign-in that proves the mailbox may unlink/clear accounts that were never proven. Verify against the live section before shipping:

[https://better-auth.com/docs/guides/1-7-upgrade-guide#two-factor-and-passwordless-security](https://better-auth.com/docs/guides/1-7-upgrade-guide#two-factor-and-passwordless-security)

Also listed in [discussion #10250](https://github.com/better-auth/better-auth/discussions/10250): “Magic-link and email-OTP sign-in can clear unproven credentials.”

### 4.14 Captcha

Quoted: “The captcha plugin now requires endpoint entries to match full auth paths unless they use wildcard patterns. … To protect multiple routes, replace partial paths like `/sign-in` with explicit wildcards such as `/sign-in/*` or `/sign-in/**`.”

Not used here.

### 4.15 Device Authorization

Unique indexes on `deviceCode` and `userCode`. “Existing installations on every adapter must resolve duplicate values before applying the migration.” Generated codes limited to 191 characters. MySQL/SQL Server also need bounded strings.

OAuth device grant is a **new** integration: `oauthDeviceAuthorization()` alongside `oauthProvider()` / `mcp()`. Optional unless you use device flow.

Not used here.

### 4.16 Custom adapters / secondary storage / rate-limit store

Upgrade guide (quoted fragments):

- “If you use only the built-in adapters and storage, you can skip this.”
- Database adapters **must** implement `incrementOne` and `consumeOne`. “`incrementOne` updates one row's counter atomically and returns the row, or null when the guard did not match. `consumeOne` reads and deletes a row in one step for single-use credentials. Both are now required, and the old fallback is gone. A missing `consumeOne` throws at runtime. All built-in adapters already do…”
- Secondary storage: `increment(key, ttl)` and `getAndDelete(key)` “were optional before and are now required.” “Redis storage already does.”
- Rate-limit storage: “needs a single `consume(key, rule)` method that checks and increments in one step. Separate `get` and `set` are no longer accepted.”

This repo uses `@better-auth/prisma-adapter` + `rateLimit: { storage: "database" }` — skip unless you added a custom adapter/store.

[https://better-auth.com/docs/guides/1-7-upgrade-guide#custom-adapters-and-storage](https://better-auth.com/docs/guides/1-7-upgrade-guide#custom-adapters-and-storage)

### 4.17 SSO / SAML / SCIM

Large breaking clusters. **Not used in this repo.** Summary only:

- SSO subjects protocol-defined; `mapping.id` removed; SAML ACS path change; IdP-initiated SAML **off** by default; SAML certs become a list; Node 20+ for samlify 2.12.
- SCIM rebuilt; “Existing SCIM installations cannot migrate provisioning state in place”; full directory reprovisioning; no longer depends on organization/SSO plugins.

See upgrade guide [Enterprise SSO](https://better-auth.com/docs/guides/1-7-upgrade-guide#enterprise-sso) and [SCIM](https://better-auth.com/docs/guides/1-7-upgrade-guide#scim).

---

## 5. OPTIONAL new features (not required to keep 1.6 behavior)

From the [1.7 blog](https://better-auth.com/blog/1-7), [release notes](https://github.com/better-auth/better-auth/releases/tag/v1.7.0), and changelogs:

| Feature | Notes |
| --- | --- |
| `hydrateSession` | Seed client with a server-fetched session so `useSession` has data on first render. Useful for Next.js App Router. [#8733](https://github.com/better-auth/better-auth/pull/8733) |
| JWKS-backed session cookie cache | `jwt({ sessionCookieCache: true })` + `session.cookieCache.strategy = "jwt"`. [#8931](https://github.com/better-auth/better-auth/pull/8931) |
| Per-request `additionalParams` / `loginHint` on `signIn.social`, `linkSocial`, `signIn.sso` | [#9305](https://github.com/better-auth/better-auth/pull/9305) |
| `user.validateUserInfo` provisioning gate | Reject identity before create/link; re-runs on OAuth/SSO sign-in. [#9864](https://github.com/better-auth/better-auth/pull/9864) |
| Per-provider `requireEmailVerification` for social | Opt-in; does **not** inherit email/password setting. [#9929](https://github.com/better-auth/better-auth/pull/9929) |
| `organization.getOrganization()` | Metadata-only fetch. [#10397](https://github.com/better-auth/better-auth/pull/10397) |
| `listUserTeams({ userId, organizationId })` | [#8977](https://github.com/better-auth/better-auth/pull/8977) |
| Passkey `createSession` on registration | Optional. [#9873](https://github.com/better-auth/better-auth/pull/9873) |
| `@better-auth/i18n` 22 languages | Additive. [#9157](https://github.com/better-auth/better-auth/pull/9157) |
| `auth create-admin` CLI | [#9547](https://github.com/better-auth/better-auth/pull/9547) |
| Auth instance fetchable | [#9431](https://github.com/better-auth/better-auth/pull/9431) |
| `addOAuthServerContext` | Server-trusted OAuth state (anonymous linking in in-app browsers). [#9930](https://github.com/better-auth/better-auth/pull/9930) |
| Granted scopes preserved across re-login | Behavior fix; no schema. [#10128](https://github.com/better-auth/better-auth/pull/10128) |
| DPoP (RFC 9449) | Opt-in; schema + verifier rename if used. |
| Back-channel logout | Opt-in per client via `backchannel_logout_uri`. Session-end token revoke is **not** opt-in (see 4.8.4). |
| RFC 8628 OAuth device grant | `oauthDeviceAuthorization()` |
| CIMD / MCP 2026-07-28 | New packages |
| Refresh-token reuse interval | Default 0 (strict); MCP defaults 30s |
| Username `immutable` / `displayUsername: false` | Opt-in |
| Phone `auth.api.consumePhoneNumberOTP` | Server-only |
| `private_key_jwt` client auth | Opt-in |
| Protected Dynamic Client Registration / initial access tokens | Opt-in |
| Requested UserInfo claims registry | Adds `requestedUserInfoClaims` columns if used |

---

## 6. What typically bites Prisma + organization + Next.js App Router + Hono

Mapped to **this** repo. Sources above.

### Prisma

1. **`Account.issuer` is required.** Generated Prisma migrate cannot backfill issuers or Microsoft `oid`. You write a data migration first, then add `NOT NULL` + unique `(issuer, accountId)`.
2. **Joins.** After moving `experimental.joins` → `advanced.database.joins`, run `npx auth generate` and keep the **relations** Better Auth emits. Missing relations → extra queries or runtime failures.
3. **oauth-provider tables already exist** (`OauthClient`, `OauthAccessToken`, `OauthRefreshToken`, `OauthConsent`, `Jwks`). 1.7 adds columns (`applicationType`, `clientDiscoveryId`, `clientCredentialsScopes`, `backchannelLogout*`, `revoked`, `confirmation`, `requestedUserInfoClaims`, `jwks.alg`/`crv`) and new tables (`oauthResource`, `oauthClientResource`, possibly `oauthClientAssertion`). Review generate output; do not blindly apply a drop of `type`/`public` before backfill.
4. **No Team tables.** Ignore `team.memberCount` / `teamMember.membershipKey` unless you enable org teams.
5. Adapter contract: built-in Prisma adapter already implements `incrementOne` / `consumeOne`. Custom wrappers around Prisma would break.

### Organization plugin

- Stripe org subscriptions already have `organization: { enabled: true }`.
- Organization hooks (`beforeCreateOrganization`, leave/remove, etc.) are not listed as broken in 1.7 notes. Still re-typecheck: 1.6.24 already changed delete-hook context forwarding.
- SCIM no longer couples to organization. N/A here.
- New `getOrganization()` is optional.

### Next.js App Router (web)

- Client plugins (`organizationClient`, `oauthProviderClient`, `passkeyClient`, `stripeClient`, `magicLinkClient`, `jwtClient`) stay on the same 1.7.0 versions as the server.
- **`unlinkAccount({ providerId })` must change** to `accountId: account.id` from `listAccounts`.
- Optional: `hydrateSession` to avoid a second `/get-session` after RSC.
- `getSessionCookie` (used in `apps/web/src/proxy.ts` and `auth.server.ts`) is not listed as removed.
- If you parse OAuth callback `?error=email_doesn't_match`, rename the string.

### Hono (core)

- Auth is mounted at `basePath: "/auth"` on Hono. After upgrade, confirm oauth-provider still serves `/.well-known/oauth-authorization-server` and openid-configuration the way `apps/core/src/routes/auth/index.ts` and `routes/well-known` wrap `oauthProviderAuthServerMetadata` / `oauthProviderOpenIdConfigMetadata`.
- **`silenceWarnings` must be deleted** or boot/types will fail.
- If you later enable DPoP: canonicalize request URL to public `baseURL` at the Hono route boundary (htu mismatch).
- Serverless/Vercel: if you enable back-channel logout, set `advanced.backgroundTasks.handler` (Vercel `waitUntil`).
- `baseURL` is a string, not `{ allowedHosts }`, so the forwarded-host default-deny likely does not apply. Still verify cookie / redirect URLs on preview hosts (`trustedOrigins` already includes `https://*.preview.sokosumi.com`).
- `oAuthProxy({ productionURL })` is not listed as removed. Re-test preview OAuth after upgrade.
- Session-bound OAuth access tokens die on sign-out. Any Hono API that accepted an opaque/JWT access token after logout will start seeing `active: false` / `invalid_token`.

### Microsoft + Google (this repo)

- Microsoft `oid` backfill is mandatory before unique index.
- Google social is otherwise unchanged; `mapProfileToUser` already does not return `id`.
- `overrideUserInfoOnSignIn: false` — 1.7 “provider profile sync respects `input: false`” is listed as a **behavior** fix in the RC notes, not a migration.

---

## 7. Schema inventory (1.7)

From the upgrade guide “These features change the schema” table plus package changelogs.

| Feature | Adds | Manual prep? | This repo? |
| --- | --- | --- | --- |
| Account identity | Required `issuer` + unique `(issuer, accountId)` | **Yes, backfill** | **Yes** |
| Protected resources | `oauthResource`, `oauthClientResource`, key columns | No (unless you have `validAudiences`) | Yes (oauth-provider) |
| Resource-bound tokens | Resource columns on token tables | No | Yes |
| DPoP | Token-binding `confirmation` column | No (only if enabled) | Optional |
| Refresh-token reuse window | Cached replay-response column on refresh tokens | No | Optional |
| Authorization-code replay | Indexed `authorizationCodeId` on token tables | No | Likely yes if generate emits it |
| Back-channel logout | Logout-URL + `oauthAccessToken.revoked` | No | Yes (columns land even if unused) |
| Requested user-info claims | `requestedUserInfoClaims` on token + consent | No | If generate emits it |
| Provider client store | `oauthApplication` → `oauthClient`; new token tables | **Yes if migrating from in-core oidc/MCP** | Already on `oauthClient`; still need 4.8.2 column backfill |
| OAuth client 1.7 fields | `applicationType`, `clientDiscoveryId`, `clientCredentialsScopes`; drop `type`/`public` | **Yes, move client data** | **Yes** |
| JWKS | nullable `alg`, `crv` | No | Yes |
| Organization team counters | `team.memberCount`, `teamMember.membershipKey` | No | No (no Team models) |
| Device Authorization | Unique `deviceCode`/`userCode`; optional `oauthClientId`/`resources` | **Yes if used** | No |
| SCIM | Seven provisioning models (+ optional catalog) replacing legacy | **Yes, reprovision** | No |
| Two-factor lockout | RC said “adds schema fields” | Unclear in stable notes | No 2FA |

---

## 8. Renamed / removed APIs (cheat sheet)

| Old | New / fate | Who cares |
| --- | --- | --- |
| `experimental.joins` | `advanced.database.joins` | This repo |
| `unlinkAccount({ providerId })` / account selectors with `providerId` | `accountId: account.id` or `useAccountCookie: true` | This repo |
| `oidcProvider` | `@better-auth/oauth-provider` | Already migrated |
| `signIn.oauth2` / `oauth2.link` / `genericOAuthClient` | `signIn.social` / `linkSocial` / social client | Generic OAuth only |
| `/api/auth/oauth2/callback/:id` | `/api/auth/callback/:id` | Generic OAuth only |
| `validAudiences` | `resources` | oauth-provider |
| `verifyAccessToken` | `verifyBearerToken` (rejects DPoP) | oauth-provider consumers |
| `AccessTokenRequestInput` | `ResourceRequestInput` | oauth-provider |
| protected `scopes` | `requiredScopes` | MCP / resource servers |
| `withMcpAuth` / `mcpHandler` | `requireMcpAuth` / `createMcpProtectedRequestHandler` | MCP |
| `silenceWarnings` | **removed** | This repo |
| `oauthClient.type` / `.public` | `applicationType` + `tokenEndpointAuthMethod` | This repo |
| `jwks: [key]` | `jwks: { keys: [key] }` | oauth-provider |
| `createAuthorizationCodeRequest` (sync) etc. | async `authorizationCodeRequest` etc. | Custom OAuth helpers |
| `email_doesn't_match` | `email_does_not_match` | Callback parsers |
| `mapping.id` (SSO OIDC/SAML) | protocol `sub` / `NameID` | SSO |
| SAML ACS `/sso/saml2/callback/:providerId` | `/sso/saml2/sp/acs/:providerId` | SAML |
| `@better-auth/cli` | npm package `auth` | Tooling |

---

## 9. Unclear / incomplete in the primary sources

1. **Docs site chrome still says “v1.6 (Latest)”** while GitHub/npm have `v1.7.0`. Use the upgrade guide body + git tag, not the version badge.
2. **Two-factor lockout columns** are named in the [RC discussion](https://github.com/better-auth/better-auth/discussions/10250) (“Two-factor account lockout adds schema fields”) but **not** enumerated in the stable 1.7.0 `better-auth` changelog. Run generate if you enable 2FA; do not invent names.
3. **Magic-link “clear unproven linked accounts”** — upgrade-guide section exists; full procedure was not fully captured in the HTML extract. Read [Two-factor and passwordless security](https://better-auth.com/docs/guides/1-7-upgrade-guide#two-factor-and-passwordless-security) before shipping. This repo uses magic link.
4. **`npx @better-auth/cli generate` vs `npx auth generate`** — both appear in official 1.7 text. npm shows only `auth@1.7.0` is the 1.7 CLI. Prefer `npx auth@1.7.0 generate`.
5. **Exact Prisma field names** for resource columns, `authorizationCodeId`, replay-cache, and `requestedUserInfoClaims` are described conceptually in the guide, not as a complete Prisma model dump. **Source of truth is `npx auth generate` against your 1.7 config.**
6. **Whether `oauthAccessToken.revoked` / resource tables appear even if you never enable back-channel logout or resources** — changelog lists them as schema changes on `@better-auth/oauth-provider`. Expect generate to emit them.
7. **`@better-auth/utils@0.5.0`** exists but is **not** a dependency of `better-auth@1.7.0` (still `0.4.2`). Do not bump unless a separate changelog for 0.5.0 is reviewed.

---

## 10. This-repo MUST-DO shortlist (1.6.29 → 1.7.0)

Not an implementation plan — a filter of the official MUST-DOs against current code.

1. Pin `better-auth`, `@better-auth/api-key`, `@better-auth/i18n`, `@better-auth/oauth-provider`, `@better-auth/passkey`, `@better-auth/prisma-adapter`, `@better-auth/stripe` to **1.7.0**. Keep `@better-auth/utils` at **0.4.2** unless you separately decide to take 0.5.0. Use CLI package **`auth@1.7.0`**, not `@better-auth/cli`.
2. Maintenance window. Backfill `account.issuer` + Microsoft `oid`. Collision query. Then unique index.
3. `experimental.joins` → `advanced.database.joins`.
4. `npx auth generate` → review Prisma → own migration (do not `auth migrate`).
5. OAuth client backfill: `applicationType`, drop `type`/`public` after map; empty `clientCredentialsScopes`.
6. Delete `silenceWarnings` from `oauthProvider({ ... })`.
7. Change `unlinkAccount({ providerId })` to local `account.id`.
8. Re-test: email/password, Google, Microsoft, magic link, passkey, org create/invite/leave, Stripe org checkout, OAuth client consent, sign-out invalidates issued access tokens, preview-host OAuth via `oAuthProxy`.
9. Read the magic-link “unproven accounts” section before cutover.

Optional follow-ups (not required to restore 1.6 behavior): `hydrateSession`, JWKS session cache, `user.validateUserInfo`, passkey `createSession`.
