## Summary

Weekly dependency scan for the Sokosumi monorepo (10 workspaces). Applied safe patch updates, a security override for transitive `undici` vulnerabilities via `@vercel/blob`, and upgraded `@openrouter/ai-sdk-provider` to v3 (AI SDK v7 alignment). Puppeteer was intentionally left at 25.1.0.

## Security (priority)

| Severity | Package | Path | Advisory | Fix |
|----------|---------|------|----------|-----|
| **High** | undici <6.27.0 | `@vercel/blob` → undici (core, web) | [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) WebSocket DoS | pnpm override → 6.27.0 |
| Moderate | undici | same | [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) Set-Cookie injection | same |
| Low | undici | same | GHSA-35p6-xmwp-9g52, GHSA-g8m3-5g58-fq7m | same |

**Reachability:** `@vercel/blob` is used directly in core (`put`, `head`, `list`) and web (`put`, client tokens) for blob storage — vulnerable path is reachable.

`pnpm audit` after fix: **no known vulnerabilities**.

## Applied updates

| Package | Current → Target | Type | Workspace |
|---------|------------------|------|-----------|
| undici (override) | 6.26.0 → 6.27.0 | security patch | root |
| @ai-sdk/react | 4.0.16 → 4.0.17 | patch | web |
| ai | 7.0.15 → 7.0.16 | patch | core, web |
| hono | 4.12.27 → 4.12.28 | patch | core |
| radix-ui | 1.6.1 → 1.6.2 | patch | web |
| @openrouter/ai-sdk-provider | 2.10.0 → 3.0.0 | major | core |

**@openrouter/ai-sdk-provider v3:** AI SDK v7-only release; peers on `ai@^7.0.0` (v2 peered on `ai@^6`). No code changes — `openrouter.client.ts` still uses `createOpenRouter({ apiKey })` with `OPENROUTER_DEFAULT_API_KEY`. `@sokosumi/ai-provider` is unaffected (separate OpenRouter HTTP client).

## Intentionally not upgraded

| Package | Current | Reason |
|---------|---------|--------|
| puppeteer / puppeteer-core | 25.1.0 | Must update hand-in-hand with `@sparticuz/chromium-min` and `CHROMIUM_EXECUTABLE_URL` |
| @types/node | 24.13.2 | Stay on v24 types per Node 24.x runtime policy (latest is v26) |

## Verification

- `pnpm install`
- `pnpm audit` — clean
- `pnpm core:typecheck`
- `pnpm core:test` — 1695 passed
- `pnpm web:test` — 1545 passed
- `openrouter.client.test.ts` — 3 passed (v3 upgrade)
