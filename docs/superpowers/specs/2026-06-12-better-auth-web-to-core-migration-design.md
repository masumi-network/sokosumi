# Better Auth Migration: web → core (complete, single PR)

**Date:** 2026-06-12
**Status:** Approved
**Decisions locked:** direct browser→core traffic (no proxy), HTTP `getSession` for web server reads, straight-to-production deploy (no preprod soak), everything in one PR.

## Goal

Move the Better Auth instance entirely from `apps/web` to `apps/core`. After this PR:

- Core runs the **only** Better Auth instance and serves all auth HTTP traffic at `<core-host>/auth/*`.
- Web is a pure consumer: browser auth client and a server-side facade, both speaking HTTP to core.
- `apps/web` has **zero runtime database access**: `apps/web/src/lib/db/prisma.ts` is deleted. (Type/enum imports from `@sokosumi/database` remain — compile-time only.)

This completes the DB-migration-web-to-core project's endgame.

## Current state (verified 2026-06-12)

- **Two instances share one Postgres DB**: web's (`apps/web/src/lib/auth/auth.ts`, ~847 lines) serves all user traffic via `/api/auth/[...all]` (`toNextJsHandler`); core's (`apps/core/src/lib/auth.ts`, ~289 lines) is mounted at `/auth` with browser CORS (`apps/core/src/routes/auth/index.ts`) and exists for OAuth-provider/MCP flows (#2881).
- Both use the same cookie-prefix util (`resolveBetterAuthCookiePrefix`), `BETTER_AUTH_SECRET` env name, uuid id generation, prisma adapter, and `basePath`-relative routing.
- Web makes **13 distinct server-side in-process `auth.api.*` calls**: `getSession` ×5, `listUserAccounts`, `upgradeSubscription`, `createBillingPortal`, `listActiveSubscriptions`, `updateUser`, `signUpEmail`, `signInEmail`, `signInMagicLink`, `setPassword`, `getOAuthClientPublic`, `createOrganization` (dead — zero callers), `createInvitation`.
- Remaining web runtime-DB files (all Better-Auth-fused): `lib/auth/auth.ts`, `lib/services/stripe.service.ts`, `lib/services/organization-subscription.service.ts`, `lib/services/preferred-organization.service.ts`, `lib/stripe/webhook-handlers.ts`, `lib/actions/subscription/action.ts`.
- An in-flight workflow (`better-auth-org-cutover` branch) is building **organization-plugin parity** on core (org hooks, invitation email, limits, cookieCache, org-subscription service port, email-locale helper, shared error constant) plus web-side invite conversion. Its output is a strict subset of this spec and is folded in. Its web `/api/auth` **forwarder task is superseded** by the direct-traffic decision and must be dropped/deleted.
- Previews run on `preview.sokosumi.com` (not `*.vercel.app`) — cross-subdomain cookies work in every environment.

## Architecture

### 1. End state

- **Core**: the single Better Auth instance. Postgres adapter, `basePath: "/auth"`, public host (e.g. `api.sokosumi.com`). Existing browser CORS + `trustedOrigins: *.sokosumi.com` already in place.
- **Web browser**: `authClient` `baseURL` → core's public auth URL (new `NEXT_PUBLIC_*` env). Cookies issued by core with `Domain=.sokosumi.com` (`BETTER_AUTH_COOKIE_DOMAIN`, already supported in core's config) so web's server can read sessions and `app.`/`preview.` pages stay authenticated. Local dev: cookies are port-agnostic on `localhost`; core trusts `localhost:*` in development.
- **Web server**: one facade module (`apps/web/src/lib/auth/`) wrapping a server-side better-auth client:
  - `getSession()` — HTTP `get-session` against core with the incoming request's cookie header, wrapped in React `cache()` (max one hop per request render). Always-correct revocation. Accepted cost: ~one intra-Vercel round-trip per page render.
  - Typed server calls for the converted `auth.api.*` sites, forwarding cookies.
  - A **Set-Cookie relay helper**: server actions that mutate auth state (sign-in/up, magic link, setPassword, updateUser) read `Set-Cookie` headers from core's response and re-set them via `next/headers` `cookies()` (replaces the `nextCookies()` plugin, which is Next-specific and not ported).
  - Exported types `Session`, `SessionUser`, `Invitation`, `Account` re-derived from the typed client (`$Infer`) — these are imported widely across web today from `auth.ts`.
- **Web `/api/auth/[...all]` route: deleted.** No proxy. (The end-state previously discussed for incremental migration is reached immediately.)

### 2. Core instance final config

Merge of both configs; **web's user-facing semantics win**. Core's existing plugins stay: `admin`, `apiKey`, `jwt`, `oauthProvider`, `oAuthProxy`, `openAPI`, `i18n`, organization (with parity from the in-flight workflow), uuid generation, DB rate-limit storage.

Adopted from web (new on core):

| Piece | Notes |
| --- | --- |
| `socialProviders` Google + Microsoft | incl. `mapProfileToUser` with profile-image upload — port `uploadProfileImage` blob util; core already uses `@vercel/blob` (#3093). `BETTER_AUTH_PROFILE_PICTURE_TIMEOUT` + `p-timeout` wrapper ported. |
| `account.accountLinking` | trustedProviders google/microsoft |
| `passkey()` | `BETTER_AUTH_RP_ID` env on core — **must equal web's current production value exactly** (existing credentials are bound to it). Page origin stays `app.sokosumi.com`, so existing passkeys remain valid. |
| `lastLoginMethod()` | with the shared cookie-name util |
| `stripe()` plugin | `stripeClient` instance, webhook secret env (new Stripe dashboard endpoint → core), `createCustomerOnSignUp: false`, subscription plans from **core's existing** `subscription-catalog.service` (#3127) adapted to the plugin's `plans` shape, `getCheckoutSessionParams`, `authorizeReference` via `memberRepository`, `onSubscriptionCreated/Update` → ported `reconcileActiveStripeBackedSubscription`, `onEvent` `customer.subscription.deleted` → ported `handleSubscriptionDeletedEvent`. |
| `session.cookieCache` | `BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE` (in-flight workflow adds) |
| `databaseHooks.account.create.after` | GTM account-created webhook |
| `databaseHooks.session.create.before` | preferred-organization resolution (ported service) |
| `databaseHooks.user.create/update` | web's richer versions: name normalization (already on core), workspace upsert (already on core), Stripe customer fire-and-forget (already on core), **plus** `marketingOptInUserSchema` validation + GTM user created/updated webhooks |
| `hooks.before/after` | sign-up terms check (`TERMS_NOT_ACCEPTED`), sign-in terms check, `/verify-email` → `syncUserEmailWithStripe` fire-and-forget (ported) |
| `disabledPaths` | **NOT ported (deviation, decided during implementation):** web disabled these HTTP paths because its server actions called them in-process; the web facade now calls them over HTTP, so disabling them would break sign-up/sign-in entirely. The terms checks these paths backstopped are enforced in `hooks.before`/`hooks.after` regardless of caller. |
| `emailAndPassword` | min/max password length envs, `sendResetPassword` (Postmark, locale-aware via the new core email-locale helper) |
| `emailVerification` | `sendVerificationEmail`, `sendOnSignUp/SignIn`, `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN`, `autoSignInAfterVerification` |
| `user.changeEmail` / `user.deleteUser` | enabled |

**Config conflict, resolved:** core's existing `magicLink` (48 h expiry, fixed `en` locale) is replaced by web's (10 min expiry, `storeToken: "hashed"`, locale-aware sender). 48 h appears to have served OAuth-provider/MCP sign-in convenience; user approved web's semantics winning. If MCP sign-ins later need longer links, that's a deliberate follow-up, not silent drift.

`nextCookies()` is **not** ported (Next-specific). Everything else in web's config must be accounted for: ported, already present, or explicitly listed as dropped in the implementation plan.

### 3. Ports into core (with their tests)

- `preferred-organization.service` — both methods (`resolveActiveOrganizationIdForSession` for the session hook; `persistPreferredOrganizationId` with its fused `$transaction`). The persist write becomes a **new core `/v1` endpoint** (session-scoped, core owns the txn); the web action calls it, contract preserved.
- `stripe.service` split rule: **methods reachable from auth hooks move to core with the instance** (`createStripeCustomerForUser/Organization`, `syncUserEmailWithStripe`); **methods not DB-dependent stay in web** (Stripe-API-only calls are not DB access — `createStripeCheckoutSession`, `claimCoupon`/`getCoupon` if still referenced, resolving customer ids via the existing #3088 core endpoints); any remaining method that is both non-hook and DB-dependent gets a core `/v1` endpoint (`syncOrganizationInvoiceEmailWithStripe`'s non-hook caller, the #3106 org invoice-email action, follows whichever half it lands in after inspection — implementation plan lists the final per-method table).
- `webhook-handlers.ts`: `reconcileActiveStripeBackedSubscription` + `handleSubscriptionDeletedEvent` move with the stripe plugin (pure DB + Stripe; core owns both).
- `gtm.service` — DB-free `fetch` calls, moves because its callers are the databaseHooks; needs its webhook-URL env vars on core.
- Organization plugin parity + org-subscription hook service + email-locale helper + shared `ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE` in `@sokosumi/utils` — **already being built by the in-flight workflow**; fold in, keep.

### 4. Web conversions (13 sites)

Every `auth.api.*` call site converts to the facade. Sites that set cookies (sign-up, sign-in email, magic link, setPassword, updateUser where it refreshes session) use the Set-Cookie relay. `createOrganization` site is dead — deleted. `createInvitation` conversion comes from the in-flight workflow. Subscription sites (`upgradeSubscription`, `createBillingPortal`, `listActiveSubscriptions`) use the stripe client plugin's server-callable equivalents over HTTP. `lib/actions/subscription/action.ts`'s `assert*` DB-helper guards are **deleted from web**; their checks move into core: `authorizeReference` covers role authorization, and any guard it does not cover (e.g. enterprise-contract exclusivity) becomes a core-side hook/plugin check enforced where the write executes. Invariant: **no session-authenticated core write may trust web-resolved money/privilege values** (established rule from #3109) — web passes intent only (plan name, seat count), core resolves everything else.

### 5. Deletions (web)

`lib/auth/auth.ts` (+ its tests, mocks), `app/api/auth/[...all]/route.ts`, `lib/services/stripe.service.ts` (or DB-free rump), `lib/services/preferred-organization.service.ts`, `lib/stripe/webhook-handlers.ts`, `lib/services/gtm.service.ts` (moved), org-hook remnants in `organization-subscription.service.ts` (workflow), **`lib/db/prisma.ts`**, the forwarder if the workflow built one. Web env vars that become core-only (Google/Microsoft secrets, `BETTER_AUTH_RP_ID`, stripe webhook secret, GTM URLs, etc.) leave web's env schema; Vercel cleanup listed in the checklist.

### 6. Session-survival shim (prevents global logout)

Today's session cookie is **host-only** on the web origin; browsers will not send it to `api.sokosumi.com`, so core would never see existing sessions → every user logged out at cutover. Mitigation: a one-time web middleware shim — when a request carries the session cookie but (heuristically) it hasn't been re-scoped yet, re-set the same cookie value with `Domain=.sokosumi.com` and matching attributes. Same value + same shared secret → core accepts it. Shim is commented for removal after one session `maxAge` window has passed.

### 7. Production cutover checklist (ordered; straight-to-prod by explicit decision)

Pre-merge (user executes, agent provides exact values):

1. Verify `BETTER_AUTH_SECRET` identical on web and core projects (mainnet + preprod).
2. Copy to core projects: `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `BETTER_AUTH_RP_ID` (exact current web value), `BETTER_AUTH_COOKIE_DOMAIN=.sokosumi.com` (and preview equivalent), GTM webhook URLs, password length values if env-driven, `BETTER_AUTH_PROFILE_PICTURE_TIMEOUT`, `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN`.
3. Google Cloud Console + Microsoft Entra: **add** core callback URLs (`<core-host>/auth/callback/google|microsoft`); keep web's registered until post-verify.
4. Stripe dashboard: create webhook endpoint → `<core-host>/auth/stripe/webhook` with the subscription lifecycle events web's endpoint has today; set its signing secret as the new core env. Keep web's endpoint until post-verify.
5. Web project: set the new `NEXT_PUBLIC` core-auth-URL env.

Merge → deploy both apps → smoke immediately (this list is the manual test script): email sign-in, Google sign-in, Microsoft sign-in, passkey sign-in, session persists across page loads, sign-up incl. verification email, password reset email, magic link, org invite end-to-end, accept invitation, billing portal, subscription seat change, checkout. Then: remove web's now-unused third-party config (old callback URLs, old Stripe endpoint, web-only envs).

**Risk statement (accepted):** sign-in, OAuth, passkeys, and billing all flip in one production deploy with no soak. Rollback = revert PR + redeploy + re-point the Stripe webhook back.

### 8. Testing

- Core: web's auth-instance tests port/adapt (hooks, plugin config); ported services bring their suites (byte-identical messages); email senders unit-tested with mocked Postmark.
- Web: facade unit tests (cookie forwarding, React cache single-hop, Set-Cookie relay incl. multiple Set-Cookie headers); per-conversion-site tests preserving existing semantics; shim middleware test.
- Repo: both full suites, both typechecks, repo-wide biome.
- Manual: the §7 smoke list.

## Out of scope

- Removing `@sokosumi/database` type/enum imports from web (compile-time only, not a violation).
- MCP/coworker auth flows beyond keeping core's existing plugins working (`apiKey`, `oauthProvider`, `oAuthProxy` untouched).
- Retiring `preview.sokosumi.com`/domain changes.
- Any web UI changes beyond what conversions strictly require.
