## Summary

Scheduled dependency scan for the sokosumi monorepo (10 workspaces). Applied safe **patch** updates plus a reviewed **postmark v5** major upgrade; deferred other major/minor updates that need review.

## Applied

### Patch updates

| Package | From | To | Workspaces |
|---------|------|-----|------------|
| `@biomejs/biome` | 2.5.2 | 2.5.3 | root |
| `@ai-sdk/provider-utils` | 5.0.5 | 5.0.6 | ai-provider |
| `@ai-sdk/react` | 4.0.18 | 4.0.19 | web |
| `ai` | 7.0.17 | 7.0.18 | core, web |
| `@vercel/blob` | 2.6.0 | 2.6.1 | core, web |
| `vite` | 8.1.3 | 8.1.4 | web |
| `@scalar/hono-api-reference` | 0.11.8 | 0.11.9 | core |
| `@scalar/openapi-to-markdown` | 0.5.31 | 0.5.32 | core |

### Major update (reviewed)

| Package | From | To | Workspace | Notes |
|---------|------|-----|-----------|-------|
| `postmark` | 4.0.7 | 5.0.0 | core | Migrates HTTP client from axios to native fetch. Usage is limited to `ServerClient.sendEmail()`; no API changes required. Removes axios transitive dependency. |

**Code change:** `isTransientPostmarkError` updated for fetch-era timeouts (`TimeoutError` / `aborted due to timeout`) so fire-and-forget email failures stay suppressed in Sentry.

## Skipped — needs human review

### Security (moderate) — **action required**

| Advisory | Package | Current | Fix | Reachability |
|----------|---------|---------|-----|--------------|
| [GHSA-p2fr-6hmx-4528](https://github.com/advisories/GHSA-p2fr-6hmx-4528) | `@better-auth/oauth-provider` | 1.6.23 | >=1.7.0-beta.4 | **Direct dep** in core + web; actively used (`oauthProvider` plugin, OAuth metadata routes, client plugin) |

Fix requires better-auth **1.7.x** with breaking changes (back-channel logout, token invalidation on session end, schema migrations). Recommend dedicated migration PR.

### Major updates

| Package | Current | Latest | Reason skipped |
|---------|---------|--------|----------------|
| `typescript` | 6.0.3 | 7.0.2 | Major — toolchain-wide impact |
| `@types/node` | 24.13.2 | 26.1.1 | Major — stay on v24 types for Node 24.x runtime |

### Coupled minor updates

| Package | Current | Latest | Reason skipped |
|---------|---------|--------|----------------|
| `puppeteer` / `puppeteer-core` | 25.1.0 | 25.3.0 | Must update hand-in-hand with `@sparticuz/chromium-min` (149.0.0) and `CHROMIUM_EXECUTABLE_URL` |

## Verification

- `pnpm install` — lockfile updated
- `pnpm test` — all workspaces pass (269 web, 231 core / 1721 tests, packages green)
- `pnpm audit` — 1 moderate advisory remains (`@better-auth/oauth-provider`)
- CI — all checks green

## Peer dependencies

No peer dependency conflicts introduced by applied updates.
