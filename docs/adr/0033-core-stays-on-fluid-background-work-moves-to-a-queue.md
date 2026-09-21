# ADR 0033: Core stays on Vercel Fluid; the job queue is deferred

- Status: Accepted
- Date: 2026-09-19
- Amended: 2026-09-20 (consumer-placement spike, then the queue deferral — see both Amendment sections)
- Filename retains the original slug so existing links keep working.

Core keeps its stack: **Hono + `@hono/zod-openapi`, TypeScript, Zod 4, Prisma on Postgres, Better Auth, Vitest, Biome, Turborepo, evlog, Vercel AI SDK**, deployed as a single Vercel function with Fluid compute. We are **not** moving Core to a long-lived container (Fly, Railway, ECS), and the 17 Vercel crons stay as they are. **No change is proposed.** A job queue was investigated in depth and is not justified at the current scope; see the second amendment. Everything else considered was either rejected or found to be already true; see Considered options.

**Why:** Core reads like an app that wants a process — 17 Vercel cron entries, a hand-rolled Postgres lease lock, Redis coordination, `resumable-stream`, `ioredis`, an in-process Soko Bot runtime. The obvious conclusion is "this should be a container." That conclusion is wrong, and this ADR exists so it is not re-derived every six months.

Fluid compute is enabled on `sokosumi-core-mainnet` and `sokosumi-core-preprod` (12/12 team projects). It already gives the container's main win: the process is reused across invocations, so one Prisma pool is shared by concurrent requests instead of one pool per request. The evidence that this is sufficient is in the code — after the P2028 incidents (SOKOSUMI-Q9, Q7, CORE-2J), **zero** GET handlers use an interactive transaction, and the 86 route files that still do are all mutations, where a transaction is correct rather than a workaround. What remains is 14 non-test references to `P2028` / `maxWait`: mostly comments and two tuned budgets.

A container would also not remove the Redis machinery. Core scales to multiple instances under load, so [`coworker-stream-lock.ts`](../../apps/core/src/helpers/coworker-stream-lock.ts) (162 lines) and [`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts) (73 lines) are multi-replica coordination, not serverless workarounds. Only the ~180 lines of in-memory-able state ([`coworker-pending-response-mirror.ts`](../../apps/core/src/helpers/coworker-pending-response-mirror.ts), [`active-ui-stream-room-metadata.ts`](../../apps/core/src/helpers/active-ui-stream-room-metadata.ts)) and `resumable-stream` would collapse, and only if Core ran a single replica — which it should not.

Scheduled work is 17 Vercel crons calling `/sync/*` GET routes, six of them every minute, each contending on one `Lock` row through `syncLockService`. The original text called this "a missing queue" and claimed **no `/sync` tick retries** — that a throw is lost until the next tick fires. **Both claims were wrong**; see the second amendment. A container would not have changed either way.

## Amendment 2, 2026-09-20: the queue is deferred

**The queue is not adopted.** The crons stay. This reverses the original proposal; everything else in this ADR — the container rejection above, and the Drizzle and Hono RPC rejections below — is unaffected and still stands on its evidence.

**The premise was wrong.** This ADR claimed `/sync` ticks have no retries and that a throw is lost. They are **reconciliation loops, not dispatchers**: each pass re-selects rows by a `where` filter, so a failed pass is retried by the next pass and no work is lost. What is actually missing is per-item attempt tracking, backoff and dead-lettering — real, but far smaller than "no retries" implied, and that inflated claim carried much of the argument.

**A queue is the wrong shape for a scanner.** Putting one underneath a reconciliation loop produces `scan → enqueue → dequeue → do` where there is currently `scan → do`: more steps, a new dependency and a second schema in the database that already carries 350 migrations, in exchange for retry bookkeeping. The payoff arrives only if the services are *also* converted from polling to event-driven, so work is enqueued when its triggering event happens. That redesign is not scoped anywhere, and this ADR never proposed it.

**There is no production evidence of queue-shaped pain.** 90 days of Sentry for `sokosumi-core` show domain errors — task status transitions, a Gmail call, a purchase diff, a missing Stripe customer — and no scheduling or reliability failures. The `/sync` routes already report to Sentry, which covers most of what a dead-letter queue would surface. Stuck rows are already findable with the same `where` clause the scanner uses; what is missing is only the ability to stop them retrying.

**The one demonstrated problem is narrow.** [`job-sync.service.ts`](../../apps/core/src/services/job-sync.service.ts) documents keeping its scan deliberately unbounded so permanently stuck jobs cannot hide newer ones. If that ever becomes an actual annoyance, `attemptCount` / `nextAttemptAt` on that one model fixes it in a migration and a `where` clause — no dependency, no schema. Doing that across many models would be reinventing a queue badly, which is why it is a one-model fix or nothing.

**Revisit when** sub-minute latency on jobs or tasks is wanted (in which case the real work is the event-driven redesign, and a queue becomes its enabler rather than the goal), or background workloads multiply and the cron list keeps growing, or stuck work starts costing something demonstrable.

The first amendment below records the consumer-placement spike. Its findings remain accurate and are worth keeping: they are what a future revisit should start from rather than repeat.

## Amendment 1, 2026-09-20: consumer placement

The consumer-placement spike overturned one premise and sharpened two numbers. **Superseded in part by Amendment 2** — at the time this was written the decision to adopt a queue still stood, and only **which** queue was open.

**"Fluid provides no request-independent process" is false.** [Vercel Queues](https://vercel.com/docs/queues) (public beta) delivers push-mode callbacks: a route declared in `vercel.json` is invoked by the platform when a message arrives.

```json
"experimentalTriggers": [{ "type": "queue/v2beta", "topic": "orders" }]
```

No cron, no worker host, no drain loop, no lock. It ships a JS SDK (`@vercel/queue`), durable append-only topics, at-least-once delivery, automatic retries with forced backoff after 32 attempts, visibility timeouts (default 60s, max 60 min), delayed delivery up to the TTL, idempotency-key dedupe, fan-out consumer groups, and message TTL from 60s to 7 days (default 24h). It is the primitive underneath Vercel Workflows.

**Cost is not a deciding factor.** Queue API Operations in `fra1` are **$0.78 per 1,000,000**, metered in 4 KiB chunks across five operation types (Send, Receive, Delete, Visibility change, Notify); idempotency-key sends and push deliveries with max concurrency bill at 2×. Push mode is roughly three operations per message:

| Messages / month | Queue ops cost |
| --- | --- |
| 100,000 | $0.23 |
| 1,000,000 | $2.34 |
| 10,000,000 | $23.40 |

Compute dominates, and there Queues *saves*: today each of the six every-minute lock keys holds a 95s drain window whether or not work exists, at roughly a 79% duty cycle. Push consumers run only when a message exists. For scale, the whole team billed $68.42 on 2026-09-16, of which Fluid was $10.57 Active CPU plus $5.50 Provisioned Memory — Core's share of that could not be isolated, because the billing tool returns aggregates plus a 100-of-1058-record sample that contained no `sokosumi-core-*` rows.

**Two corrections to the original text.** Latency is not "up to 60s": `LOCK_TIMEOUT` (120s) minus `LOCK_TIMEOUT_BUFFER` (25s) gives a **95s drain window** against a 60s cron, so ticks overlap, the later one takes the 409, and the worst-case gap is about **25s**. And `maxDuration: 300` is no longer the ceiling — Vercel functions now run up to **30 minutes**, so a longer window would nearly close that gap.

**The cron-drain shape is cheaper to build than assumed.** [`routes/sync/handler.ts`](../../apps/core/src/routes/sync/handler.ts) already *is* a drain-with-deadline loop: cron-secret auth, lease acquire, async-ack 200, `waitUntil`, and `abortSignal` / `msRemaining()` / `shouldContinue()` handed to the operation. Adopting `pg-boss` there means swapping `syncLockService` for `fetch()` / `complete()` / `fail()` inside a loop that exists today.

**The axis that actually decides it is transactional enqueue.** `pg-boss` lives in the same Postgres as the domain data, so a job can be enqueued in the same transaction as the write that causes it. Vercel Queues is a separate system and cannot. For `/sync/task-payment-claims` and the credit flows that is a correctness property, not a preference. For the four `soko-bot` crons and notification follow-ups it is not.

**A hybrid is therefore live**, and after the dead-letter findings below the line is drawn more narrowly than transactional enqueue alone: use `pg-boss` wherever a message **must not be silently dropped**, which covers the money paths and anything an operator would want to inspect and replay. Vercel Queues push mode suits genuinely fire-and-forget work — the four `soko-bot` crons, avatar copying, notification follow-ups — where losing a message costs a retry at worst.

### Dead-letter and `v2beta`, checked 2026-09-20

Four findings, all of which cut against Vercel Queues:

**There is no dead-letter queue.** The docs state it plainly: poisoned messages are handled in the application, via the SDK's `retry` callback returning `{ acknowledge: true }` to drop the message or `{ afterSeconds }` to back off, plus a `maxDeliveries` cap on the trigger. An acknowledged poison message is simply **gone** — there is nothing to inspect or requeue. `pg-boss` parks it in a dead letter queue with `redrive()`. For `/sync/task-payment-claims` that difference is the whole argument.

**Failed push deliveries are expensive, and unbounded by default.** Every delivery is a function invocation, and *"if a delivery fails by timing out, it is billed for the function's full `maxDuration` at its configured memory."* `maxDeliveries` defaults to **Unlimited**, so a poisoned message retries until its TTL — up to 24 hours. With Core at `maxDuration: 300`, a timing-out consumer bills 300s per attempt for a day. This qualifies the cost finding above: queue *operations* are negligible, failed *deliveries* are not. Any trigger must set `maxDeliveries` explicitly and an observability retry-depth alert.

**Messages are pinned to the deployment that published them.** Promoting or rolling back does **not** stop deliveries to the old deployment — its consumers keep being invoked and retried until every message it published is acknowledged or expires. The documented way to stop it is to **delete the deployment**. That is a meaningfully different rollback story from anything else in this stack.

**No ordering guarantee.** Delivery is approximate write order; retried messages are deprioritized behind new ones, and there is no FIFO even at max concurrency 1. Consumers must tolerate arbitrary order.

One more, specific to us: **strict data residency is not supported yet.** During a regional outage Vercel may temporarily store messages in a neighboring region. Core and its database are in Frankfurt / `eu-central-1`; whether that is acceptable is a legal question, not a technical one.

On `v2beta` itself: the trigger type is `queue/v2beta` under `experimentalTriggers`, the product is public beta, and the docs state no stability or migration guarantee.

**Unrelated finding, tracked as SOK-1129:** `@vercel/functions` exports `attachDatabasePool`, which releases idle pool clients before a function suspends and supports `pg`. Core uses it nowhere, and Core's P2028 history is exactly what it addresses. `@prisma/adapter-pg` 7.10.0 accepts a `pg.Pool` instance (`disposeExternalPool` defaults to `false`), so the pool can be built and attached in Core and handed to the adapter — but `@vercel/functions` is an app dependency, not a `@sokosumi/database` one, so the pool must be constructed on the Core side rather than inside the client factory. The ticket gates on measuring actual connection pressure first.

## Considered options

- **Move Core to a long-lived container** — rejected. The pooling argument it usually rests on was already solved in the read paths; the lock machinery survives the move; the scheduling gap does not close. Real but smaller wins (streams outliving an invocation, dropping `resumable-stream`) do not pay for leaving the Vercel deploy path, `waitUntil`, and preview deploys.
- **Swap Prisma for Drizzle** — rejected. At 113 models the migration cost is large and the benefit (no engine, leaner pool semantics) is mostly priced in by Fluid's process reuse.
- **Keep cron-over-HTTP, add retries by hand** — rejected. That is a third lock implementation, after the Redis one and the Postgres one.
- **`pg-boss` on the existing Postgres** — **investigated, not adopted** (Amendment 2). It was the leading candidate for the money paths, and the research below stands for a future revisit. Verified against **12.33.2** (MIT; requires Node >= 22.12 and Postgres 13+, both satisfied; built on `SKIP LOCKED`): retries with exponential backoff (`retryLimit` default 2, `retryDelay`, `retryBackoff`, `retryDelayMax`); job leases via `expireInSeconds` (default 15 minutes) plus `heartbeatSeconds` / `touch()`, so a worker that dies mid-job is retried rather than stranding a lock; `singletonKey` / `singletonSeconds` with `sendThrottled()` and `sendDebounced()`; cron and RRULE scheduling; and a dead letter queue with `redrive()`. It subsumes [`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts) outright, and uniquely supports transactional enqueue. It adds no new runtime dependency of consequence: Core already pins `cron-parser` at the version pg-boss requires, and `@sokosumi/database` already depends on `pg` 8.23.0 (alongside `@prisma/adapter-pg`), which satisfies pg-boss's `pg ^8.23.0`.
- **Vercel Queues in push mode** — viable for fire-and-forget paths only, added and then narrowed by the 2026-09-20 amendment. Removes the consumer-placement problem outright rather than solving it, and queue operations are negligibly cheap. Against it: **no dead-letter queue** (a poisoned message is acknowledged away, not parked), failed deliveries billed at full `maxDuration` with `maxDeliveries` unlimited by default, messages pinned to the publishing deployment so a rollback does not stop consumers, no ordering guarantee, no transactional enqueue, no strict data residency yet, public beta (`queue/v2beta`), and Vercel lock-in.
- **Replace the generated Core client with Hono RPC (`hc<AppType>`)** — **rejected**, reversing an earlier draft of this ADR. The generated client looks like codegen overhead, but it is what makes the web→Core boundary structural instead of conventional. Today `apps/web/package.json` has **no dependency on `@sokosumi/core`**, and the client is 18 committed files under `apps/web/src/lib/clients/generated/core/`. `hc<AppType>` requires a `workspace:*` dependency on Core, and because turbo's `build` and `typecheck` both `dependsOn: ["^build"]`, that puts Core's 131k LOC in front of every web typecheck and Core's dependency tree — including `@sokosumi/database` — into web's install graph. A type-only import keeps Prisma out of the web *bundle*, but the [Database Access](../agents/architecture.md#database-access) rule stops being enforced by the dependency graph and starts being enforced by discipline. The build step is cheaper than that trade. The committed snapshot also makes web/Core deploy skew *visible*: regenerate, typecheck, see the drift. Direct type imports would bind web to Core's source rather than to Core's deployed contract.
- **Narrow `neverthrow` out of the Core route layer** — **rejected as already true**, correcting an earlier draft that called for it. Core has **zero** route files importing `neverthrow` and only two non-test files in total: [`x402-settlement.ts`](../../apps/core/src/helpers/x402-settlement.ts) and [`task-schedule-quarantine.service.ts`](../../apps/core/src/services/task-schedule-quarantine.service.ts), both genuine expected-failure branches. `neverthrow` is predominantly a **web** convention — 42 files under `apps/web/src/lib/actions/` — bound to the `ActionResultDto` Flight-serialization boundary documented in [`.cursor/rules/neverthrow.mdc`](../../.cursor/rules/neverthrow.mdc). The earlier draft asserted it "touches many of the 428 route files"; that was inferred from the rule's existence, never measured, and is false. No refactor is warranted.
- **A worker-only host alongside Vercel** for a `pg-boss` consumer — demoted by the amendment. Still the fallback if push mode is rejected and the ~25s cron-drain gap proves unacceptable, but it is no longer the shape to beat.

## Consequences

- **Nothing changes.** The 17 crons, [`routes/sync/handler.ts`](../../apps/core/src/routes/sync/handler.ts), [`sync-lock.service.ts`](../../apps/core/src/services/sync-lock.service.ts) and the `Lock` Prisma model all stay exactly as they are. No dependency is added and no schema is created.
- Core stays on Vercel Fluid. Do not reopen the container question without new evidence; the measurements above are the reason.
- `generate:core:snapshot`, the 18 generated files, and the DTO-drift typecheck step all stay. Web keeps no dependency on `@sokosumi/core`, and the two apps keep building independently.
- `neverthrow` needs no work. The convention in [`.cursor/rules/neverthrow.mdc`](../../.cursor/rules/neverthrow.mdc) stands as written and is already honoured; do not open a refactor pass against it.
- If a queue is revisited, start from the amendments rather than from scratch. They already record: `pg-boss` 12.33.2's feature set and that `migrate: false` plus CLI-generated DDL keeps its schema inside Prisma's migration history; that its `db` option (`executeSql(text, values)`) lets it share Core's connections instead of opening its own pool; that `routes/sync/handler.ts` is already a drain-with-deadline loop; Vercel Queues' pricing, its lack of a dead-letter queue, and its deployment-pinned consumers. Two things remain **unverified**: whether `pg-boss`'s `db` adapter can be pointed at an in-progress transaction client for transactional enqueue, and what `queue/v2beta` implies for stability.
- SOK-1130 was the first slice and is **cancelled**, with this reasoning recorded on the ticket.
