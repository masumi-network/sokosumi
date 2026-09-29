# ADR 0039: Core stays on Vercel Fluid; the job queue is deferred

- Status: Accepted
- Date: 2026-09-19
- Amended: 2026-09-20 (queue deferred)
- Renumbered from ADR-0033 to ADR-0039; ADR-0033 belongs to Typing.

Core keeps its stack: **Hono + `@hono/zod-openapi`, TypeScript, Zod 4, Prisma
on Postgres, Better Auth, Vitest, Biome, Turborepo, evlog, Vercel AI SDK**,
deployed as a single Vercel function with Fluid compute. We are **not**
moving Core to a long-lived container (Fly, Railway, ECS). The 20 Vercel
crons stay. **A job queue is not adopted.** Everything else considered was
either rejected or found to be already true; see Considered options.

**Why:** Core reads like an app that wants a process — 20 Vercel cron
entries, a hand-rolled Postgres lease lock, Redis coordination,
`resumable-stream`, `ioredis`, an in-process Soko Bot runtime. The obvious
conclusion is "this should be a container." That conclusion is wrong, and
this ADR exists so it is not re-derived every six months.

Fluid compute is enabled on `sokosumi-core-mainnet` and
`sokosumi-core-preprod` (12/12 team projects). It already gives the
container's main win: the process is reused across invocations, so one
Prisma pool is shared by concurrent requests instead of one pool per
request. The evidence that this is sufficient is in the code — after the
P2028 incidents (SOKOSUMI-Q9, Q7, CORE-2J), **zero** GET handlers use an
interactive transaction, and the 86 route files that still do are all
mutations, where a transaction is correct rather than a workaround. What
remains is 14 non-test references to `P2028` / `maxWait`: mostly comments
and two tuned budgets.

A container would also not remove the Redis machinery. Core scales to
multiple instances under load, so
[`coworker-stream-lock.ts`](../../apps/core/src/helpers/coworker-stream-lock.ts)
(162 lines) and
[`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts)
(73 lines) are multi-replica coordination, not serverless workarounds. Only
the ~180 lines of in-memory-able state
([`coworker-pending-response-mirror.ts`](../../apps/core/src/helpers/coworker-pending-response-mirror.ts),
[`active-ui-stream-room-metadata.ts`](../../apps/core/src/helpers/active-ui-stream-room-metadata.ts))
and `resumable-stream` would collapse, and only if Core ran a single replica
— which it should not.

Scheduled work is 20 Vercel crons calling `/sync/*` GET routes, nine of them
every minute, each contending on one `Lock` row through `syncLockService`.
Those ticks are **reconciliation loops, not dispatchers**: each pass
re-selects rows by a `where` filter, so a failed pass is retried by the next
pass and no work is lost. What is missing is per-item attempt tracking,
backoff and dead-lettering — real, but far smaller than "no retries." A
queue under a scanner produces `scan → enqueue → dequeue → do` where there
is currently `scan → do`. The payoff arrives only if the services are also
converted from polling to event-driven, and that redesign is not scoped.

There is no production evidence of queue-shaped pain. 90 days of Sentry for
`sokosumi-core` show domain errors, not scheduling or reliability failures.
The `/sync` routes already report to Sentry. Stuck rows are findable with
the same `where` clause the scanner uses.

The one demonstrated problem is narrow.
[`job-sync.service.ts`](../../apps/core/src/services/job-sync.service.ts)
keeps its scan deliberately unbounded so permanently stuck jobs cannot hide
newer ones. If that becomes an actual annoyance, `attemptCount` /
`nextAttemptAt` on that one model fixes it — no dependency, no schema.

**Revisit when** sub-minute latency on jobs or tasks is wanted (the real
work is then the event-driven redesign, and a queue becomes its enabler), or
background workloads multiply and the cron list keeps growing, or stuck work
starts costing something demonstrable. Start from the spent investigation
below rather than from scratch.

## Spent investigation (2026-09-20)

A consumer-placement spike ran while a queue was still the proposal, then
Amendment 2 reversed the proposal. Keep the findings; do not re-shop.

- [`routes/sync/handler.ts`](../../apps/core/src/routes/sync/handler.ts)
  already *is* a drain-with-deadline loop (cron-secret auth, lease, async-ack
  200, `waitUntil`, `abortSignal` / `msRemaining()` / `shouldContinue()`).
  Worst-case gap between overlapping ticks is about **25s**
  (`LOCK_TIMEOUT` 120s minus `LOCK_TIMEOUT_BUFFER` 25s against a 60s cron).
  Functions now run up to 30 minutes.
- **`pg-boss` 12.33.2** was the leading candidate wherever a message **must
  not be silently dropped** (money paths, inspect-and-replay). Same Postgres
  as the domain data, so transactional enqueue is possible; dead letter with
  `redrive()`; `migrate: false` plus CLI-generated DDL keeps its schema in
  Prisma history; `db.executeSql` can share Core's pool. Core already pins
  `cron-parser` and `@sokosumi/database` already depends on `pg` 8.23.0.
  **Unverified:** whether `db` can point at an in-progress transaction
  client.
- **Vercel Queues** push mode (`queue/v2beta`, public beta) removes the
  consumer-placement problem. Queue ops in `fra1` are cheap (~$0.78 per 1M).
  Against it: **no dead-letter queue** (an acknowledged poison message is
  gone), failed deliveries billed at full `maxDuration` with `maxDeliveries`
  unlimited by default, messages pinned to the publishing deployment (rollback
  does not stop them; delete the deployment), no ordering, no transactional
  enqueue, no strict data residency yet. Viable only for genuinely
  fire-and-forget work.
- SOK-1129 (`attachDatabasePool` + `@prisma/adapter-pg` 7.10.0 `pg.Pool`)
  still gates on measuring connection pressure. SOK-1130 (first queue slice)
  is **cancelled**.

## Considered options

- **Move Core to a long-lived container** — rejected. Pooling on the read
  paths is already solved; the lock machinery survives the move; the
  scheduling gap does not close. Smaller wins (streams outliving an
  invocation, dropping `resumable-stream`) do not pay for leaving the Vercel
  deploy path, `waitUntil`, and preview deploys.
- **Swap Prisma for Drizzle** — rejected. At 113 models the migration cost is
  large and the benefit is mostly priced in by Fluid's process reuse.
- **Keep cron-over-HTTP, add retries by hand** — rejected. That is a third
  lock implementation, after the Redis one and the Postgres one.
- **`pg-boss` on the existing Postgres** — investigated, not adopted. See
  Spent.
- **Vercel Queues in push mode** — fire-and-forget only. See Spent.
- **Replace the generated Core client with Hono RPC (`hc<AppType>`)** —
  **rejected**. `apps/web/package.json` has **no dependency on
  `@sokosumi/core`**; the client is 18 committed files under
  `apps/web/src/lib/clients/generated/core/`. `hc<AppType>` requires a
  `workspace:*` on Core, putting Core's 131k LOC in front of every web
  typecheck and Core's tree — including `@sokosumi/database` — into web's
  install graph. The [Database Access](../agents/architecture.md#database-access)
  rule would stop being enforced by the dependency graph. The committed
  snapshot also makes web/Core deploy skew visible.
- **Narrow `neverthrow` out of the Core route layer** — **rejected as already
  true**. Core has **zero** route files importing `neverthrow` and only two
  non-test files:
  [`x402-settlement.ts`](../../apps/core/src/helpers/x402-settlement.ts) and
  `task-schedule-quarantine.service.ts` (removed with
  [ADR 0041](0041-recurring-rules-move-to-task-schedule.md)).
  `neverthrow` is a **web** convention (42 files under
  `apps/web/src/lib/actions/`), bound to `ActionResultDto`.
- **A worker-only host alongside Vercel** for a `pg-boss` consumer — fallback
  if a future revisit rejects push mode and the ~25s cron-drain gap proves
  unacceptable. Not the shape to beat today.

## Consequences

- **Nothing changes.** The 20 crons,
  [`routes/sync/handler.ts`](../../apps/core/src/routes/sync/handler.ts),
  [`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts)
  and the `Lock` Prisma model all stay. No dependency is added and no schema
  is created.
- Core stays on Vercel Fluid. Do not reopen the container question without
  new evidence.
- `generate:core:snapshot`, the 18 generated files, and the DTO-drift
  typecheck step all stay. Web keeps no dependency on `@sokosumi/core`.
- `neverthrow` needs no work. The convention in
  [`.cursor/rules/neverthrow.mdc`](../../.cursor/rules/neverthrow.mdc) stands.
- If a queue is revisited, start from Spent rather than from scratch.
