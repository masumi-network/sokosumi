# ADR 0033: Core stays on Vercel Fluid; background work moves to a job queue

- Status: Proposed
- Date: 2026-09-19

Core keeps its stack: **Hono + `@hono/zod-openapi`, TypeScript, Zod 4, Prisma on Postgres, Better Auth, Vitest, Biome, Turborepo, evlog, Vercel AI SDK**, deployed as a single Vercel function with Fluid compute. We are **not** moving Core to a long-lived container (Fly, Railway, ECS). Three changes are proposed instead: a real job queue (`pg-boss`), Hono RPC for the internal web→Core call path, and `neverthrow` narrowed to service boundaries.

**Why:** Core reads like an app that wants a process — 17 Vercel cron entries, a hand-rolled Postgres lease lock, Redis coordination, `resumable-stream`, `ioredis`, an in-process Soko Bot runtime. The obvious conclusion is "this should be a container." That conclusion is wrong, and this ADR exists so it is not re-derived every six months.

Fluid compute is enabled on `sokosumi-core-mainnet` and `sokosumi-core-preprod` (12/12 team projects). It already gives the container's main win: the process is reused across invocations, so one Prisma pool is shared by concurrent requests instead of one pool per request. The evidence that this is sufficient is in the code — after the P2028 incidents (SOKOSUMI-Q9, Q7, CORE-2J), **zero** GET handlers use an interactive transaction, and the 86 route files that still do are all mutations, where a transaction is correct rather than a workaround. What remains is 14 non-test references to `P2028` / `maxWait`: mostly comments and two tuned budgets.

A container would also not remove the Redis machinery. Core scales to multiple instances under load, so [`coworker-stream-lock.ts`](../../apps/core/src/helpers/coworker-stream-lock.ts) (162 lines) and [`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts) (73 lines) are multi-replica coordination, not serverless workarounds. Only the ~180 lines of in-memory-able state ([`coworker-pending-response-mirror.ts`](../../apps/core/src/helpers/coworker-pending-response-mirror.ts), [`active-ui-stream-room-metadata.ts`](../../apps/core/src/helpers/active-ui-stream-room-metadata.ts)) and `resumable-stream` would collapse, and only if Core ran a single replica — which it should not.

What Fluid genuinely does not give is a **request-independent worker**. Nothing in Core runs unless an HTTP request arrives, so scheduled work is 17 Vercel crons calling `/sync/*` GET routes, six of them every minute, each contending on one `Lock` row through `syncLockService`. That is a polling scheduler assembled from cron and a lease lock: minimum latency for queued work is up to 60s, each tick is capped by `maxDuration: 300`, and retries and backoff do not exist. This is a missing queue, not a missing process — a container would have inherited the same gap.

## Considered options

- **Move Core to a long-lived container** — rejected. The pooling argument it usually rests on was already solved in the read paths; the lock machinery survives the move; the scheduling gap does not close. Real but smaller wins (streams outliving an invocation, dropping `resumable-stream`) do not pay for leaving the Vercel deploy path, `waitUntil`, and preview deploys.
- **Swap Prisma for Drizzle** — rejected. At 113 models the migration cost is large and the benefit (no engine, leaner pool semantics) is mostly priced in by Fluid's process reuse.
- **Keep cron-over-HTTP, add retries by hand** — rejected. That is a third lock implementation, after the Redis one and the Postgres one.
- **`pg-boss` on the existing Postgres** — chosen for background work. Leases, retries, backoff, singleton jobs and scheduling, no new infrastructure. It subsumes `sync-lock.service.ts` outright.
- **Keep OpenAPI codegen for web→Core** — rejected for the internal path. `hc<AppType>` gives end-to-end types with no build step. OpenAPI stays for the public/partner API, where the contract is external and versioned (see `apps/core/AGENTS.md`).

## Consequences

- `pg-boss` needs a worker that runs without an HTTP request. On Fluid this means a small always-on consumer (a separate deploy target or a dedicated long-running invocation); resolving that is in scope for the implementing spec, and if no acceptable option exists, this ADR is the right place to reopen the container question.
- [`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts) and the `Lock` Prisma model are deleted once `/sync/*` becomes queue consumers; that is a schema migration. The `crons` block in `apps/core/vercel.json` shrinks to nothing.
- Dropping `generate:core:snapshot` removes the generated client under `apps/web/src/lib/clients/generated/` and the DTO-drift typecheck step, but couples web builds to Core's types directly. The [Database Access](../../AGENTS.md) rule is unaffected — web still reaches data only through Core.
- `neverthrow` stays where failure is an expected branch (credits, vendor grants) and leaves the route layer. This is mechanical but touches many of the 428 route files, so it lands incrementally, not as one PR.
- Nothing here is implemented. Status stays `Proposed` until the first slice ships.
