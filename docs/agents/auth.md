# Auth: Better Auth hooks, OAuth clients, preview sign-in

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies. Core's OAuth provider and its clients: [OAuth clients](../oauth-clients.md), [ADR 0045](../adr/0045-cmo-signs-in-through-core-oauth-provider.md), [ADR 0046](../adr/0046-first-party-clients-skip-consent.md).

## Core after hooks

- **Success is any status below 400.** A successful social or OAuth callback ends by throwing a redirect, so `ctx.context.returned` is an `APIError` (`FOUND`) on every good sign-in. Guard a failure with `returned instanceof APIError && returned.statusCode >= 400`; `instanceof APIError` alone silently skips every OAuth sign-in. `keepNewSessionPersistent` in `apps/core/src/lib/auth-new-session.ts` is the pattern.
- **The OAuth provider re-runs the hooks.** Once a sign-in sets the session cookie during an OAuth request, `@better-auth/oauth-provider` resumes `/oauth2/authorize` through every before and after hook, with `newSession` still set. A hook that reads `newSession` must expect that resumed call, and a hook that sets the session cookie must skip `/oauth2/authorize`, or the provider resumes again without end and the sign-in never answers.
- **Test the whole hook chain.** OAuth provider tests wire `afterNewSession` (the ordered after hook), never a single step: a test with one helper misses the resume loop. On a preview the loop shows as an endless spinner with only the CORS preflight in Core's logs and no client callback.

## Auth rate limits

Better Auth uses Redis for per-IP, per-endpoint counters. An atomic increment starts the endpoint's fixed window on the first request. A denied request reports the full window in `X-Retry-After`. Sessions and verification values use PostgreSQL.

Auth, chat read budgets, and newsletter limits share a Redis client with a 250 ms command timeout and offline queuing disabled. If commands are pending and the socket receives no data for 1 second, the client closes the socket and flushes its command queue. Requests fail open while that client is connecting, including on a cold start. Core sets `rateLimit.failOpen` and records the cause on the request's wide event. Each Redis client warns once for its first startup error and re-arms the warning every time it becomes ready. The edge auth flood guard provides the first layer of throttling in production.

Follow-up for the 2026-11-08 incident (SOKOSUMI-CORE-4Y). Drop the Prisma `RateLimit` model and table in a separate migration after all deployments and their rollback targets have stopped using the table.

## Session cookie cache

- **A Core write to a session field does not reach the UI at once.** Core caches the session in a cookie for `BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE` (5 minutes by default), and a Prisma write such as `PATCH /v1/users/{id}/preferences` does not refresh that cookie. The route returns 200, but `useSession()` keeps the old value until the cache expires. For a change the UI must show now, write with `authClient.updateUser`, or switch the active organization with `auth.api.setActiveOrganization`.

## OAuth clients

- **Changing a skip-consent client's redirect**: take every custom scheme off the client row before `skipConsent` goes on, because any app can register a scheme. Ship in order: the web side (association file, routes), then the redirect URI swap, then the flag. Installed builds that use the old redirect break at the swap.
- **`invalid_code` on a confidential client** (CMO) usually means the code was exchanged twice: look for two callbacks in the client app's logs and two `/auth/oauth2/token` calls in Core's. The cause is a second navigation after a Better Auth client call that returned `{ redirect, url }` (ADR 0046).
- **Core's `auth` reads and writes the database when it starts.** The provider seeds the MCP resource row ([ADR 0076](../adr/0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md)). Core's unit setup (`src/test/setup.ts`) answers that table in memory, so a test that loads `auth` needs nothing. A test that mocks `@/lib/db/prisma` replaces that answer; without `oauthResource` in its mock the seed is skipped quietly, but an `oauthResource` that throws logs an error.
- **Registration scopes are a union, and Better Auth stores all of it.** Every client from `/oauth2/register` gets `clientRegistrationDefaultScopes` plus `clientRegistrationAllowedScopes`, whatever it asked for. Registration is open (ADR 0076), so neither list may hold `sokosumi:api`. Web's `/oauth2/create-client` is a different path, checked against `scopes`, and keeps the API tick. `clientRegistrationDefaultResources` would link clients from both paths, so Core keeps the MCP resource in `clientRegistrationAllowedResources` and its before hook (`applyOAuthClientPolicy`) asks for it on each registration. The same hook refuses `sokosumi:mcp` on Web's create and update.
- **`selfRegistered` on the public client info.** Core's after hook (`afterAuthRequest`, which tests wire) adds it to `/oauth2/public-client` and `/oauth2/public-client-prelogin`: true when the client has neither `userId` nor `referenceId`, as every client from open registration. Web's consent page warns unless it is `false`.
- **A client-resource link stores the resource's identifier** (its URL), not its row id; the foreign key references `oauthResource.identifier`.
- **A non-2xx discovery fetch is silent.** Better Auth's generic OAuth plugin skips a provider whose discovery request fails, without an error. Log the URL and status yourself when a provider seems missing.
- **Read the `redirect_uri` a deployed client sends** without a browser: `curl -X POST https://<host>/api/auth/sign-in/social -H 'origin: https://<host>' -H 'content-type: application/json' -d '{"provider":"sokosumi","callbackURL":"/"}'`, then read `redirect_uri` from the returned `url`.

## Previews and production

- **Preview data is bound to production secrets.** Preview and agent Neon branches fork mainnet, so they hold production's OAuth client rows and `jwks` keys encrypted with production's `BETTER_AUTH_SECRET`. When an OAuth or JWT feature breaks only on a preview, suspect copied data before the code. A working Web sign-in on the preview proves nothing for OAuth: session sign-in never touches `jwks`. Fix such breaks in code or config (as `jwtKeyStoreOptions` does), never with CI writes into preview databases (ADR 0045).
- **Prove sign-in changes on the preview.** Preview deploys run the real code against a copy of real data, and the local worktree stack cannot complete every flow. A person signs in on the `/deploy` preview (previews serve the live Turnstile key, which an agent never answers); the agent reads the console, network, and Core's logs on the failing submit. Stay read-only there: no messages, no record changes.
- **Production sign-in checks**: a person runs the whole flow in one browser, start to end, because a magic link opened in another browser loses the state cookie. Verify the result from the project's Vercel runtime logs (`vercel logs`).
