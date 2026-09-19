# ADR 0034: `@sokosumi/database` stays a separate package

- Status: Accepted
- Date: 2026-09-19

`@sokosumi/database` has exactly one consumer — `apps/core` is the only workspace that declares it — and a single-consumer package is normally indirection without payoff. We keep it separate anyway. The original draft of this ADR framed the package's `tsc` build as friction to be removed; measurement showed the opposite. **The build step is load-bearing: the emitted `.d.ts` is what makes Core's own code typecheck.** Both ways of removing it — a just-in-time package, and folding the package into Core — were tried and produce the same 31 type errors.

**Why the package looks redundant:** `apps/core/package.json` is the only `package.json` depending on it; `packages/utils` names it in four comments but imports it zero times; `apps/web` has none, as the [Database Access](../../AGENTS.md) rule requires. Of the seven workspace packages, `@sokosumi/database` is also the only one without a `prepare` script, so it needs turbo `prisma:generate` locally and in CI and a four-step `vercel-build` in Core ([ADR 0008](./0008-turbo-task-runner-on-pnpm.md)). Single consumer plus a documented build exception reads like an obvious merge candidate.

**Why it is not.** Two experiments, both reverted:

1. **Just-in-time package.** Pointing `exports` at `./src`, with `noExternal: ["@sokosumi/database"]` in Core's `tsup` so the TypeScript gets bundled. The *build* side works completely: Core bundles, `@sokosumi/database` disappears from the external imports, the bundle loads and reaches env validation, and turbo drops from 9 tasks to 8. But `pnpm --filter @sokosumi/core typecheck` fails with **31 errors across 11 files** — 14 × TS2322, 8 × TS2345, 6 × TS2551, 2 × TS2339, 1 × TS7006.
2. **Simulated merge.** Core `tsconfig.json` `paths` pointing each `@sokosumi/database` subpath at the package's source, which is the resolution a merge would produce. Result: the **identical 31 errors**, plus rootDir noise from the probe itself.

The errors are not in the database package. They are in Core's own files, and they show Prisma's type inference degrading: `include` payloads collapse to the base model (`Property 'senderUser' does not exist… did you mean 'senderUserId'?`), `Record<string, unknown>` stops being assignable to `InputJsonValue`, and `Decimal` resolves to `typeof Decimal`.

**What the cause is not.** Compiling the database source under Core's `moduleResolution: "bundler"` is fine on its own — a probe tsconfig that pulls `packages/database/src/**` into Core's project reports **zero** real errors. Setting `verbatimModuleSyntax: false` in Core changes nothing (still 31). So this is not Prisma's generated client failing under bundler resolution, and not a single-flag mismatch.

**What it appears to be, unverified:** declaration emit resolves Prisma's deep conditional types into concrete declarations, and Core consuming those resolved declarations infers correctly where Core re-instantiating the same generic machinery from source does not. That is a hypothesis, not a diagnosis. Anyone retrying this should start by diffing `dist/index.d.ts` against what `src/index.ts` (which re-exports `./generated/prisma/browser.js`) surfaces to a consumer.

## Considered options

- **Fold `@sokosumi/database` into `apps/core`** — **rejected**, on evidence rather than on sequence. The simulated merge reproduces the same 31 type errors, because a merged package is compiled from source by Core exactly as a just-in-time one is. It would also rewrite imports in 279 non-test files (519 including tests), relocate `prisma/schema.prisma` and `prisma.config.ts`, move six `data-migration:*` scripts, and fold a vitest project into Core's — for a build exception it does not actually delete.
- **Keep the package and make it just-in-time** (`exports` → `./src`) — **attempted and rejected**, see above. Builds and runs; does not typecheck.
- **Align Core's tsconfig with the package's** (`module`/`moduleResolution` → NodeNext) so both compile the same way — not attempted. It would break Core's extensionless imports repo-wide, and the probe result above suggests resolution mode is not the cause anyway.
- **Keep everything exactly as it is** — chosen, now with a reason beyond inertia. The `prepare` asymmetry and the four-step `vercel-build` are the price of Core getting resolved Prisma declarations, and that price is worth paying.
- **Keep the package because it enforces the web/Prisma boundary** — rejected as a *reason*, though the conclusion matches. Unlike the generated Core API client in ADR 0033, this package boundary is not load-bearing for the web rule: `apps/web` has no dependency on `apps/core` either, so folding the database into Core would leave Prisma exactly as unreachable from web. The boundary argument does not transfer, and should not be cited for it.

## Consequences

- `@sokosumi/database` keeps its `tsc` build, its `dist` output, and its absent `prepare`. Core keeps the four-step `vercel-build`. None of that is cleanup waiting to happen; it is the working configuration.
- Do not re-attempt the merge or the just-in-time switch on the "single consumer" argument alone. The blocker is the 31 type errors, and it is independent of how many consumers the package has — [ADR 0033](./0033-core-stays-on-fluid-background-work-moves-to-a-queue.md)'s `pg-boss` consumer placement no longer gates this decision either way.
- Reopening this needs the type-inference difference root-caused first, not a second attempt at the same two shapes.
- The other six packages stay as they are. They already carry `prepare` scripts, so just-in-time would remove no exception, and four of them (`utils`, `email`, `masumi`, `net`) are consumed by web's Next.js build, which would need `transpilePackages` on top.
- `packages/utils` must keep referencing `@sokosumi/database` in prose only. An actual import there would break the [utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) rule and give the package a second consumer for the wrong reason.
