# ADR 0034: `@sokosumi/database` stays a separate package

- Status: Accepted
- Date: 2026-09-19

`@sokosumi/database` has exactly one consumer — `apps/core` is the only workspace that declares it — and a single-consumer package is normally indirection without payoff. We keep it separate anyway, and instead remove the build special-casing that makes it annoying. Folding it into `apps/core` is deferred until [ADR 0033](./0033-core-stays-on-fluid-background-work-moves-to-a-queue.md)'s `pg-boss` consumer placement is settled, because that decision may produce a second consumer.

**Why:** The single-consumer observation is correct and worth recording so it is not rediscovered as a surprise. `apps/core/package.json` is the only `package.json` depending on it; `packages/utils` names it in four comments but imports it zero times; `apps/web` has none, as the [Database Access](../../AGENTS.md) rule requires.

What makes the merge unattractive is the ratio. It would rewrite imports in 279 non-test files (519 including tests), relocate `prisma/schema.prisma` and `prisma.config.ts`, move six `data-migration:*` scripts, and fold a vitest project into Core's. The payoff is deleting one build exception: of the seven workspace packages, `@sokosumi/database` is the only one without a `prepare` script, so it needs turbo `prisma:generate` locally and in CI and a four-step `vercel-build` in Core ([ADR 0008](./0008-turbo-task-runner-on-pnpm.md)).

That exception can be removed without the rewrite. Pointing the package's `exports` at `./src` instead of `./dist` — a just-in-time package, consumed as TypeScript by Core's `tsup` — drops the `tsc` build step, the `dist` staleness, and the `prepare` asymmetry, while leaving the boundary and every import path untouched. That change is easily reversible and therefore does not need its own ADR; it ships as a separate PR, and if `tsup` or turbo will not take it cleanly, the status quo stands and this ADR is unaffected.

The decisive reason to wait rather than merge now is [ADR 0033](./0033-core-stays-on-fluid-background-work-moves-to-a-queue.md). If the `pg-boss` consumer becomes a worker-only host, that worker needs database access and the package is correct as it stands. If the cron-as-drain shape wins, Core remains the only consumer and the merge becomes clean. Merging first risks a week spent undoing it.

## Considered options

- **Fold `@sokosumi/database` into `apps/core`** — deferred, not rejected. Correct in principle for a single-consumer package; wrong in sequence while ADR 0033 is open, and a poor trade at 279 files rewritten for one build exception deleted.
- **Keep the package and make it just-in-time** (`exports` → `./src`) — chosen direction. Removes the exception, keeps the imports. Separate PR; reversible; no ADR of its own.
- **Keep everything exactly as it is** — rejected. The `prepare` asymmetry is real friction: it is the reason Core's `vercel-build` chains `prisma:generate`, the database `tsc`, `tsup`, and `migrate` instead of just building.
- **Keep the package because it enforces the web/Prisma boundary** — rejected as a *reason*, though the conclusion happens to match. Unlike the generated Core API client in ADR 0033, this package boundary is not load-bearing: `apps/web` has no dependency on `apps/core` either, so folding the database into Core would leave Prisma exactly as unreachable from web. The boundary argument does not transfer, and should not be cited for it.

## Consequences

- Revisit this ADR when ADR 0033's consumer placement is decided. A worker-only host settles it as "keep"; cron-as-drain reopens the merge as a clean follow-up.
- The just-in-time change lands separately. Until it does, `@sokosumi/database` keeps its `tsc` build and Core keeps its four-step `vercel-build`.
- `packages/utils` must keep referencing `@sokosumi/database` in prose only. An actual import there would break the [utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) rule and give the package a second consumer for the wrong reason.
