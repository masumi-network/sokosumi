# Better Auth Cookie Prefixes From `VERCEL_GIT_COMMIT_REF`

## Summary

Replace preview cookie-prefix resolution with a branch-first rule based on
`VERCEL_GIT_COMMIT_REF`.

Target behavior:

- mainnet => `sokosumi`
- preprod => `sokosumi-preprod`
- preview + non-empty `VERCEL_GIT_COMMIT_REF` =>
  `sokosumi-preview-<sanitized-branch>`
- preview + missing/empty `VERCEL_GIT_COMMIT_REF` => `sokosumi-preview`

This is a hard cutover for preview deployments. Existing preview sessions will
stop matching once and require reauthentication.

## Problem

The current preview resolver infers cookie prefixes from preview hostnames or
`VERCEL_BRANCH_URL`. That adds unnecessary parsing logic and already caused app
and core preview deployments to disagree on the cookie name, which broke
session-based authentication across services.

The obvious fix is to use one shared preview identity that both services get
from Vercel: the git branch ref.

## Decisions

### 1. `VERCEL_GIT_COMMIT_REF` always wins on previews

If `VERCEL_ENV === "preview"` and `VERCEL_GIT_COMMIT_REF` sanitizes to a
non-empty string, that value defines the preview cookie prefix.

This removes dependency on:

- project-specific preview hostnames
- `VERCEL_BRANCH_URL`
- `VERCEL_GIT_PULL_REQUEST_ID`

### 2. Preview fallback is plain `sokosumi-preview`

If a preview deployment does not expose a usable `VERCEL_GIT_COMMIT_REF`, the
fallback prefix is always `sokosumi-preview`.

We will not keep host-based fallback logic.

### 3. Production and preprod behavior stays unchanged

The current explicit prefixes remain:

- mainnet => `sokosumi`
- preprod => `sokosumi-preprod`

Only preview identity changes.

## Implementation Plan

### Shared resolver

Update
[packages/utils/src/better-auth-cookie-prefix.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/packages/utils/src/better-auth-cookie-prefix.ts)
to:

- accept `vercelEnv?: string`
- accept `vercelGitCommitRef?: string`
- keep the existing host checks for mainnet and preprod
- for previews, derive the prefix only from `VERCEL_GIT_COMMIT_REF`
- fall back to plain `sokosumi-preview` when the commit ref is missing or empty
- delete branch-URL and project-host parsing helpers that are no longer needed

### Environment plumbing

Expose `VERCEL_GIT_COMMIT_REF` wherever cookie names are computed:

- web server env:
  [apps/web/src/config/env.secrets.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/config/env.secrets.ts)
- web public env:
  [apps/web/src/config/env.public.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/config/env.public.ts)
- web build-time env pass-through:
  [apps/web/next.config.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/next.config.ts)
- core env:
  [apps/core/src/config/env.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/core/src/config/env.ts)

### Resolver call sites

Update all cookie-prefix consumers to pass `vercelEnv` and
`vercelGitCommitRef`:

- [apps/web/src/lib/auth/auth.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/lib/auth/auth.ts)
- [apps/core/src/lib/auth.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/core/src/lib/auth.ts)
- [apps/web/src/proxy.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/proxy.ts)
- [apps/web/src/app/(auth)/signin/page.tsx](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/app/(auth)/signin/page.tsx)
- [apps/web/src/app/(auth)/signup/page.tsx](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/app/(auth)/signup/page.tsx)
- [apps/web/src/lib/auth/auth.client.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/lib/auth/auth.client.ts)

The client-side case needs the public env value so the browser computes the same
cookie name as the server.

## Tests

Update and add tests for:

- shared resolver:
  [packages/utils/src/__tests__/better-auth-cookie-prefix.test.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/packages/utils/src/__tests__/better-auth-cookie-prefix.test.ts)
- web auth config:
  [apps/web/src/lib/auth/__tests__/auth.test.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/lib/auth/__tests__/auth.test.ts)
- core auth config:
  [apps/core/src/lib/auth.test.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/core/src/lib/auth.test.ts)
- proxy cookie lookup:
  [apps/web/src/__tests__/proxy.test.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/__tests__/proxy.test.ts)
- client cookie-name resolution if needed:
  [apps/web/src/lib/auth/__tests__/auth.client.test.ts](/Users/andreas/Developer/masumi-network/sokosumi-review/apps/web/src/lib/auth/__tests__/auth.client.test.ts)

Minimum coverage:

- preview commit ref produces branch-based prefix
- preview empty commit ref produces `sokosumi-preview`
- preview commit ref overrides hostname-derived identity
- prod and preprod remain unchanged
- app and core derive the same preview prefix from the same branch ref

## Rollout

- Ship as a hard cutover
- Do not add compatibility logic for old preview cookie names
- Expect one-time preview reauthentication after deploy

## Non-Goals

- no use of `VERCEL_GIT_PULL_REQUEST_ID`
- no use of `VERCEL_BRANCH_URL` for cookie prefix resolution
- no change to cookie domain behavior
- no change to production or preprod prefixes

## Risks

- If `VERCEL_GIT_COMMIT_REF` is not exposed in a preview deployment, all such
  deployments will share `sokosumi-preview`
- The browser client must receive the same branch ref as the server-side auth
  config or `last_used_login_method` reads can drift again

## Validation

After implementation:

- run targeted utils, web, and core auth tests
- verify one preview signs in successfully
- verify authenticated browser calls to core no longer return invalid session
- verify two different preview branches create visibly different cookie groups
