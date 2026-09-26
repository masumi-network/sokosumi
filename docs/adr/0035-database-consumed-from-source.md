# ADR 0035: `@sokosumi/database` is consumed from source

- Status: Accepted
- Date: 2026-09-19
- Supersedes: [ADR 0034](./superseded/database-stays-a-separate-package.md)

Core stops consuming `@sokosumi/database` through emitted declarations and consumes its TypeScript directly. The package's `tsc` build and its `dist` output go away. The end state is the package folded into `apps/core`, reached in four steps so the type work lands before anything moves.

**Why:** declaration emit silently discards types. `tsc` widens **18** of Prisma's runtime value re-exports to `any`:

```
source   prismaNamespaceBrowser.ts:23   export const Decimal = runtime.Decimal
emitted  prismaNamespaceBrowser.d.ts:4  export declare const Decimal: any;
```

The same happens to `DbNull`, `JsonNull`, `AnyNull`, `Sql`, `empty`, `join`, and the five `PrismaClient*Error` classes. Prisma defines `NullableJsonNullValueInput` and its siblings in terms of `typeof JsonNull`, so those unions collapse to `any` in the built declarations, and **every JSON-column write in Core has been typechecking against `any`**. [ADR 0034](./superseded/database-stays-a-separate-package.md) read the resulting 31 errors as proof that the build was protecting Core. It was hiding work.

**The errors are real and they collapse quickly.** Under source resolution Core reports 31 errors across 11 files, with zero files resolved from `dist`. Tightening one return type — `mergeChatRoomMessageMetadata` from `Record<string, unknown> | null` to `Prisma.InputJsonObject | null` — takes that to **15**, eliminating all six TS2551 and the TS7006. A failed assignability check on `data` breaks generic inference for the whole Prisma call, the `include` payload collapses to the base model, and phantom errors like `Property 'senderUser' does not exist` appear downstream. Roughly 14 genuine errors, the rest cascade.

**All five entry points must move together.** Mapping only the main entry to source while `./client`, `./repositories`, `./helpers` and `./types/job` still resolve to `dist` yields **553** errors — two nominally distinct instantiations of the Prisma types in one program. A partial migration is far worse than either end state.

**The runtime shape is proven.** Core's `tsup` needs both halves:

```ts
noExternal: ["@sokosumi/database"],
external: ["pg", "@prisma/client", "@prisma/adapter-pg"],
```

`noExternal` alone inlines `pg`, which is CommonJS, and the bundle dies at import with `Dynamic require of "events" is not supported`. Keeping the drivers external also stops the 4.37 MB wasm query compiler being inlined as base64. With that config a bundled probe ran `prisma.user.count()` (146 rows) and `` $queryRaw`SELECT 1` `` against a live Neon branch, so the wasm compiler, the adapter, and the round trip are all verified — not just that the bundle imports.

## Sequence

1. A second Core `tsconfig` whose `paths` map all five `@sokosumi/database` subpaths at `../../packages/database/src/…`, wired as a CI check. Nothing moves; the masked errors become visible and regressions are gated.
2. Fix the real type errors behind it.
3. The just-in-time switch: package `exports` → `./src`, the `tsup` config above, `build`/`clean` scripts removed. Two files.
4. Fold the package into `apps/core`: 279 non-test import sites (519 with tests), `prisma/schema.prisma`, `prisma.config.ts`, six `data-migration:*` scripts, the vitest project, `turbo.json`, and Core's `vercel-build`.

**Status:** steps 1–3 landed together in SOK-1126. Step 1's temporary
`tsconfig` was not needed: once the package's `exports` point at source, Core's
ordinary `typecheck` already resolves from source and is itself the gate. The
31 errors and the zero `dist` resolutions were both reproduced, and the bundled
probe was re-run against a dead port (`P1001` on the model query, `P2010` on the
raw one) to confirm the wasm query compiler still loads. Step 4 is untouched.

Steps 1–3 carry the whole type-safety benefit. Step 4 is organisational — one fewer workspace, one fewer build exception — and by then it is mechanical, because source resolution is already green in CI.

## Considered options

- **Keep the `tsc` build** — rejected. It is not insulation, it is 18 `any`s. Cost of keeping it: JSON writes and `Decimal` arithmetic go unchecked in Core.
- **Just-in-time only, no merge** — acceptable stopping point. Steps 1–3 deliver every type and build benefit; step 4 adds only the workspace reduction. If step 4 stalls, nothing is lost.
- **Merge first, fix types after** — rejected. The type errors are identical either way, and hitting them mid-move means debugging types and file locations at once.
- **Align Core's tsconfig with the package's** (`moduleResolution` → NodeNext) — not needed. The package source compiles clean under Core's `bundler` settings; resolution mode was never the problem.

## Consequences

- Core's program grows by ~129 files from `packages/database/src`, and `skipLibCheck` no longer shields them. Today they compile clean under Core's tsconfig. A future `prisma generate` emitting source Core's config rejects would block Core's typecheck instead of being absorbed into a `.d.ts` — that is the price of the checking, and it is worth paying.
- [ADR 0008](./0008-turbo-task-runner-on-pnpm.md) described a `vercel-build` that ran `prisma:generate`, the database `tsc`, `tsup`, then `migrate`. The `tsc` step disappeared at step 3; that ADR and the three `AGENTS.md` files that documented the removed database package build alias were updated in the same change (SOK-1126).
- `packages/database` keeps `prisma:generate`. Generating the client is unrelated to compiling it, and remains required everywhere.
- The `prepare` asymmetry across the seven packages ends. The other six keep their `prepare` scripts; nothing about this decision applies to them, and four are consumed by web's Next.js build, which would need `transpilePackages` on top.
- **The other six were measured, not assumed** (SOK-1126 follow-up). The case above rests on declaration emit widening Prisma's `export const X = runtime.X` re-exports to `any`. No other package emits that pattern: grepping each `dist` for `export declare const …: any` gives **zero** across `ai-provider`, `email`, `masumi`, `net`, `soko-bot` and `utils`. Masumi's 86 `: any` in `.d.ts` are authored, not emitted — its source carries 172, in the generated wallet-client transformers. Utils' single match is inside a comment. So there is no hidden type loss to surface, which was the entire benefit here.
- Migrating the rest would also cost more, not less. `masumi`, `net`, `soko-bot` and `utils` are consumed by `apps/web`, whose `next.config` sets no `transpilePackages`; moving them to source means adding it and having Next compile that source on every web build. `database` was Core-only and bundled by `tsup`. What remains is one fewer `prepare` step for the two Core-only packages (`ai-provider`, `email`) and no type-safety gain — so do not extend this decision to them on the strength of it having worked here.
