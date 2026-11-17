# Deploys, Vercel, and Sentry

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies. How production and previews deploy: [README Deployment](../../README.md#deployment). Sentry and `requestId` lookups: [skill routing](./skill-routing.md#sentry-errors).

## Production deploys

- **A merge is a production deploy.** Every merge to `main` production-deploys Core, Web, and CMO wherever the change affects them; there is no separate release step. `/deploy mainnet` builds previews on a Neon copy of mainnet, not production.
- **Prove a Core change is live** before merging anything that depends on it: `curl -s https://api.sokosumi.com/v1/openapi.json` and look for the new `operationId`. A merge alone proves nothing, because the ignore step may skip a project, and the deploy takes minutes.
- **Release-ordered PRs** (Core route, then its caller, then a lock) merge one at a time, each after the previous one is live.

## Vercel builds

- **A stuck or OOM build: read the first build-log lines first.** `Build machine configuration` names the machine. Elastic selection can pick 4 cores / 8 GB, where Web's full compile hangs at "Creating an optimized production build" or exits 137; a good build on 8 cores / 16 GB beside it confirms the machine, not the code. See the Sentry loader comment in `apps/web/next.config.ts`.
- **The ignore step shows as BUILDING** for up to a minute (clone and cache restore) before a skipped deployment turns CANCELED; wait before reading states.
- **A new Vercel project starts with "Skip deployments when there are no changes" on.** Turn it off (README), since `ignoreCommand` does that job.

## Vercel URLs and env

- **`VERCEL_PROJECT_PRODUCTION_URL` is baked at build time** and can name a `*.preview.sokosumi.com` production alias instead of the custom domain, which sends the wrong OAuth `redirect_uri`. Keep the custom domain the project's only production alias; after a Domains change, redeploy production, since the running deployment keeps the old value.
- **`VERCEL_RELATED_PROJECTS` appends the requesting project's preview suffix**, so a CMO preview gets Core's alias on `preview.cmo.xyz`. `sokosumiPreviewUrl` in `apps/cmo/src/lib/auth-config.ts` swaps in `preview.sokosumi.com`; reuse it for any new related project.
- **Query a new hostname only after its DNS record exists.** Resolvers cache the NXDOMAIN for the zone's negative TTL, so an early lookup keeps the new site unreachable for that long on the whole network. Before the record propagates, ask the authoritative nameserver and use `curl --resolve`.

## Sentry

- **Prove Sentry-visible behaviour on production.** Sentry shows only `environment: production`; confirm whether any deployment reports at all by sending a request with your own `X-Request-Id` and querying `requestId:<tag>` in Sentry Logs (production lands within about a minute). For anything only Sentry can show, plan a production query after merge and say so in the PR. Traces are sampled at 0.5% (`tracesSampleRate` in `apps/core/src/lib/sentry.ts`); errors are not sampled.
- **Core "N+1 Query" issues are usually false positives.** Core sends no SQL text (`databaseQueryData: false`, which keeps secrets out), so every DB span reads `[Filtered]` with one hash and any three consecutive queries trip the detector, typically the auth middleware's. Before changing a route, compare each span's `data.sentry.group` in the event JSON: different groups mean no N+1. Recurring false positives are fixed by turning off the project's N+1 DB detector, not in code.
- The Sentry CLI needs the org prefix: `sentry issue view masumi/SOKOSUMI-CORE-40`.
