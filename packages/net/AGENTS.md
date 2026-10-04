# Net Package Agent Guidelines

> **Purpose**: Package-specific guidelines for `@sokosumi/net`. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/net`
**Purpose**: HTTP helpers: SSRF-safe fetch for untrusted URLs (`ssrfSafeFetch`) and outbound webhook transport for operator env URLs (`postWebhook`)
**Runtime**: Node.js 24.x
**Location**: `packages/net/` within the pnpm workspace

## Layout

The live tree is `src/`. One main export in `package.json`. `prepare` compiles `src/` to `dist/`. Implementation is `src/ssrf-fetch.ts` and `src/webhook.ts`.

## Entry Points

```typescript
import {
  postWebhook,
  ssrfSafeFetch,
  type SsrfSafeFetchInit,
} from "@sokosumi/net";

const response = await ssrfSafeFetch(url, { maxResponseBytes: 1024 * 1024 });
await postWebhook(url, payload, { userAgent: "Sokosumi-Core-API/1.0" });
```

`ssrfSafeFetch` callers today: Masumi agent client, Core unfurl/import/drive copy, Web PDF/DOCX export and DESIGN.md blob fetch.

`postWebhook` callers today: Core webhook client and job-sync-state. Destinations are operator env URLs, not end-user input.

## Key Conventions

- Use `ssrfSafeFetch` for any fetch whose URL is attacker- or user-controlled. Global `fetch` does not filter private/loopback/link-local addresses.
- Use `postWebhook` (global `fetch`) for operator-configured webhook URLs. Do not wrap those env destinations in `ssrfSafeFetch`.
- `maxResponseBytes` is required. The client rejects omitted, zero, or non-finite caps so a caller cannot buffer an unbounded body.
- Only GET/HEAD follow redirects (max 5 hops). Each hop is re-validated. POST/PUT/etc. return the 3xx as-is.
- Returns a standard `Response`. Malformed or non-http(s) URLs throw `SsrfError`. Address-level blocks come from `request-filtering-agent` at connect time.

## Package-Specific Commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @sokosumi/net build` | Compile `src/` to `dist/` |
| `pnpm --filter @sokosumi/net test` | Run Vitest (unit + integration) |
| `pnpm --filter @sokosumi/net typecheck` | Typecheck |
| `pnpm --filter @sokosumi/net lint` | Lint |

`@sokosumi/net` is in `allowBuilds` so filtered Vercel installs still run `prepare`.

## Testing

Place `ssrf-fetch.test.ts` next to `ssrf-fetch.ts` and `webhook.test.ts` next to `webhook.ts`. `ssrf-fetch.integration.test.ts` covers connect-time address filtering.

## Best Practices

### Do

- Pass a positive `maxResponseBytes` at every `ssrfSafeFetch` call site
- Keep Masumi agent jobs, chat unfurl, source import, and export image fetches on `ssrfSafeFetch`
- Keep Core operator webhooks on `postWebhook`

### Don't

- Call global `fetch` (or a raw http/https agent) for untrusted remote URLs
- Follow POST redirects in callers; this client does not, and the 3xx body is not an acceptance

## References

- [Root AGENTS.md](../../AGENTS.md)
- [Masumi AGENTS.md](../masumi/AGENTS.md) (agent client is the primary package consumer)
