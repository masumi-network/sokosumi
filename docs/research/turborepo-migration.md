# Turborepo vs this pnpm workspace — primary-source research

Researched 2026-08-20 against **primary sources only**. Claims below are quoted or paraphrased from those sources and cited with URL + section heading. Nothing here is an implementation plan or a migrate / do-not-migrate recommendation.

**This repo today (observed, not invented):** pnpm@11.22.0 workspace (`apps/*`, `packages/*`). Apps: `web` (Next.js 16), `core` (Hono). Packages: `@sokosumi/database`, `@sokosumi/masumi`, `@sokosumi/utils`, `@sokosumi/net`, `@sokosumi/email`, `@sokosumi/chat`, `@sokosumi/ai-provider`. Root scripts use `pnpm -r` / `pnpm --filter`. No `turbo.json`, no Nx. Root typecheck is a hand-coded DAG: `pnpm database:build && pnpm -r typecheck`. Core has another hand-coded DAG: `build:workspace-deps` (net → utils → masumi → database prisma generate + build → chat → ai-provider → email). CI is GitHub Actions with separate workflows for build, lint, and test; setup caches pnpm via `actions/setup-node`, not a task cache. Husky precommit: `pnpm check && pnpm typecheck`. Packages are compiled (`tsc` / `tsup` to `dist`). `@sokosumi/database` `prepare` runs `prisma generate` then `build`. Root lint/check/format already run Biome from the workspace root.

The official docs index lists a pnpm tool page (`https://turborepo.dev/docs/guides/tools/pnpm`). That URL returned no body when fetched on 2026-08-20. pnpm-specific official content used below comes from other Turborepo pages that do render (workspace layout, dependency management, GitHub Actions, Vercel filtered installs).

## Sources

| Source | URL |
| --- | --- |
| Introduction | https://turborepo.dev/docs |
| Getting started | https://turborepo.dev/docs/getting-started |
| Installation | https://turborepo.dev/docs/getting-started/installation |
| Add to an existing repository | https://turborepo.dev/docs/getting-started/add-to-existing-repository |
| Crafting your repository | https://turborepo.dev/docs/crafting-your-repository |
| Structuring a repository | https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository |
| Managing dependencies | https://turborepo.dev/docs/crafting-your-repository/managing-dependencies |
| Configuring tasks | https://turborepo.dev/docs/crafting-your-repository/configuring-tasks |
| Running tasks | https://turborepo.dev/docs/crafting-your-repository/running-tasks |
| Caching (crafting) | https://turborepo.dev/docs/crafting-your-repository/caching |
| Caching (core concepts, same body as crafting caching) | https://turborepo.dev/docs/core-concepts/caching |
| Using environment variables | https://turborepo.dev/docs/crafting-your-repository/using-environment-variables |
| Constructing CI | https://turborepo.dev/docs/crafting-your-repository/constructing-ci |
| Developing applications | https://turborepo.dev/docs/crafting-your-repository/developing-applications |
| Core concepts | https://turborepo.dev/docs/core-concepts |
| Package and Task Graphs | https://turborepo.dev/docs/core-concepts/package-and-task-graph |
| Internal Packages | https://turborepo.dev/docs/core-concepts/internal-packages |
| Remote Caching | https://turborepo.dev/docs/core-concepts/remote-caching |
| GitHub Actions | https://turborepo.dev/docs/guides/ci-vendors/github-actions |
| CI vendors overview | https://turborepo.dev/docs/guides/ci-vendors |
| Vercel (Turborepo CI recipe) | https://turborepo.dev/docs/guides/ci-vendors/vercel |
| Migrating from Nx | https://turborepo.dev/docs/guides/migrating-from-nx |
| Next.js | https://turborepo.dev/docs/guides/frameworks/nextjs |
| Biome | https://turborepo.dev/docs/guides/tools/biome |
| Prisma (Turborepo stub) | https://turborepo.dev/docs/guides/tools/prisma |
| Prisma official Turborepo guide | https://www.prisma.io/docs/guides/turborepo |
| Vitest | https://turborepo.dev/docs/guides/tools/vitest |
| TypeScript | https://turborepo.dev/docs/guides/tools/typescript |
| Skipping tasks | https://turborepo.dev/docs/guides/skipping-tasks |
| Recursive `turbo` invocations | https://turborepo.dev/docs/messages/recursive-turbo-invocations |
| `turbo.json` configuration | https://turborepo.dev/docs/reference/configuration |
| `turbo run` | https://turborepo.dev/docs/reference/run |
| `turbo watch` | https://turborepo.dev/docs/reference/watch |
| Acknowledgements | https://turborepo.dev/docs/acknowledgments |
| Docs index | https://turborepo.dev/llms.txt |
| Deploying Turborepo to Vercel | https://vercel.com/docs/monorepos/turborepo |
| Vercel Remote Caching | https://vercel.com/docs/monorepos/remote-caching |
| Vercel Remote Caching from external CI/CD | https://vercel.com/docs/monorepos/remote-caching/external-ci-cd |
| Next.js CI build caching | https://nextjs.org/docs/app/guides/ci-build-caching |

No official “Turborepo vs pnpm recursive” or “Turborepo vs Nx comparison” marketing page exists in the docs index. The only first-party migration comparison is [Migrating from Nx](https://turborepo.dev/docs/guides/migrating-from-nx). pnpm appears as prior art on [Acknowledgements](https://turborepo.dev/docs/acknowledgments) and as the package manager Turborepo sits on top of.

---

## 1. What Turborepo actually is

Turborepo is “the build system for coding agents,” “designed for scaling monorepos,” and also usable in single-package workspaces.

[https://turborepo.dev/docs](https://turborepo.dev/docs) — “What is Turborepo?”

It is **not a package manager** and **not a replacement for pnpm workspaces**.

- “You can **use it with any package manager**, like `npm`, `yarn` or `pnpm` since Turborepo leans on the conventions of the npm ecosystem.” It “uses the `package.json` scripts you've already written, the dependencies you've already declared, and a single `turbo.json` file.” Incremental adoption: “you can **add it to any repository in just a few minutes**.”

  [https://turborepo.dev/docs](https://turborepo.dev/docs) — “The monorepo solution”

- “`turbo` is built on top of Workspaces, a feature of package managers in the JavaScript ecosystem.” For pnpm the workspace file is `pnpm-workspace.yaml` with `apps/*` and `packages/*`. A lockfile is required; “Turborepo uses the lockfile to understand the dependencies between your Internal Packages.”

  [https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — “Anatomy of a workspace”, “Specifying packages in a monorepo”, “Package manager lockfile”

- “**Turborepo does not manage dependencies**, leaving that work up to your package manager of choice. It's up to the package manager to handle things like downloading the right external dependency version, symlinking, and resolving modules.”

  [https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — “Turborepo does not manage dependencies”

- Root `package.json` in official examples keeps the package manager and adds `turbo` as a root `devDependency`, with scripts like `"build": "turbo run build"`. pnpm workspaces stay declared in `pnpm-workspace.yaml`.

  [https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — “Root `package.json`”

What it *does* add: (1) a **task graph** over the existing package graph, (2) **local filesystem cache** of task outputs + logs, (3) optional **Remote Cache**, (4) **parallel scheduling** across cores.

[https://turborepo.dev/docs](https://turborepo.dev/docs) — “The monorepo solution”; [https://turborepo.dev/docs/core-concepts/package-and-task-graph](https://turborepo.dev/docs/core-concepts/package-and-task-graph) — “Package Graph”, “Task Graph”

This repo’s `apps/*` + `packages/*` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` + root `package.json` with `"packageManager": "pnpm@11.22.0"` already matches the layout Turborepo documents as the minimum for a multi-package workspace. The missing pieces named by official “add to existing” steps are: install `turbo`, add `turbo.json`, add `.turbo` to `.gitignore`. The repo already has a package-manager declaration (`packageManager`); official docs now also recommend `devEngines.packageManager`.

[https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository) — “Adding Turborepo to your repository”

---

## 2. What it would replace in this repo

Official model: `turbo` runs **existing per-package `package.json` scripts** whose names match keys in `turbo.json`. Root scripts become `turbo run <task>` (or `turbo run` in CI). Per-package scripts stay `next build`, `tsc`, `vitest run`, etc.

[https://turborepo.dev/docs/crafting-your-repository/running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) — “Using `scripts` in `package.json`”; [https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository) — “Add a `turbo.json` file”

Mapped onto this repo’s current root scripts:

| Current root script | What it does today | Official turbo equivalent |
| --- | --- | --- |
| `build`: `pnpm -r build` | Recursive build of every package that has `build` | `"build": "turbo run build"` with `"dependsOn": ["^build"]` |
| `test` / `test:ci`: `pnpm -r test` | Recursive tests | `turbo run test` / `turbo run test:ci` |
| `typecheck`: `pnpm database:build && pnpm -r typecheck` | Hand-coded “build database, then typecheck everyone” | `dependsOn` on `typecheck` (and/or `^build`) instead of `&&` |
| `dev`: `pnpm -r --parallel dev` | All package `dev` scripts in parallel | `turbo run dev` with `"cache": false`, `"persistent": true` |
| `core` `build:workspace-deps` | Hand-coded package build order for Core | `"dependsOn": ["^build"]` plus an explicit prisma generate task |
| CI `pnpm build` / `pnpm typecheck` / matrix `pnpm web:test:ci` etc. | Separate GHA workflows, no task cache | `turbo run` in those jobs; optional Remote Cache / `--affected` |

### Hand-coded DAGs → `dependsOn`

`^build` means: run `build` in **direct internal dependencies** first, walking from the bottom of the package graph.

[https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — “Dependency relationships”; [https://turborepo.dev/docs/crafting-your-repository/configuring-tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) — “Depending on tasks in dependencies with `^`”

Same-package ordering (no `^`): `"test": { "dependsOn": ["build"] }` waits for `build` in the **same** package.

[https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — “Same package relationships”

Arbitrary package-task edges exist: `"web#lint": { "dependsOn": ["utils#build"] }`.

[https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — “Arbitrary task relationships”

This repo’s two explicit DAGs are exactly those three `dependsOn` shapes:

1. Root `typecheck` prefixes `database:build` because `@sokosumi/database` is a compiled package (`exports` point at `dist/*.d.ts`) and `tsc --noEmit` does not emit. Official compiled-package model is `build` via `tsc` with `outputs: ["dist/**"]`, then dependents wait on `^build`.

   [https://turborepo.dev/docs/core-concepts/internal-packages](https://turborepo.dev/docs/core-concepts/internal-packages) — “Compiled Packages”

2. Core `build:workspace-deps` is a linear `pnpm --filter A build && … && pnpm --filter Z build`. Official replacement is the package graph plus `"build": { "dependsOn": ["^build"] }`. Prisma generate is a separate task in the Prisma guide (`db:generate` with `"cache": false`, and `build`/`dev` `dependsOn: ["^db:generate"]`).

   [https://www.prisma.io/docs/guides/turborepo](https://www.prisma.io/docs/guides/turborepo) — “4. Configure task dependencies in Turborepo”

### CI task fan-out

Today: three workflows (`build.yml`, `lint.yml`, `test.yml`); test uses a matrix of `pnpm web:test:ci` / `pnpm core:test:ci` / `pnpm --filter "./packages/*" test:ci`. Setup action caches the **pnpm store**, not task outputs.

Official GitHub Actions recipe is one job that `pnpm install` then `pnpm build` / `pnpm test` where those root scripts are `turbo run …`. Remote Cache is a separate optional step (OIDC or PAT). `actions/cache` on `.turbo` is an alternative if not using Vercel Remote Cache.

[https://turborepo.dev/docs/guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) — example workflow; “Remote Caching with Vercel Remote Cache”; “Remote Caching with GitHub actions/cache”

`--affected` and `turbo query affected` are the official ways to skip unchanged packages in CI rather than a GHA matrix.

[https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Running only affected tasks”; [https://turborepo.dev/docs/guides/skipping-tasks](https://turborepo.dev/docs/guides/skipping-tasks)

Official CI example checks out with `fetch-depth: 2`. `--affected` / git filters need enough history; shallow clones make **all** packages look changed. Suggested checkout: `--filter=blob:none --depth=0`.

[https://turborepo.dev/docs/guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions); [https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--affected`

---

## 3. What it would **not** replace

| Layer | Why turbo does not replace it |
| --- | --- |
| **pnpm workspace + lockfile + install** | Turbo “does not manage dependencies.” Workspace discovery is `pnpm-workspace.yaml`. |
| **Package graph** | Turbo **reads** the graph the package manager already built from `workspace:` deps. |
| **Next.js** | Turbo runs `next build` / `next dev` as scripts. Framework guide is “add Next.js to a turbo repo,” not replace Next. Outputs for Next: `.next/**`, `!.next/cache/**`, `!.next/dev/**`. |
| **Biome** | Official Biome guide: keep `biome check .` as a **root** script; turbo only registers `//#format-and-lint`. This repo already runs `biome check .` from root. |
| **Vitest** | Per-package `vitest run` stays. Turbo orchestrates/caches those scripts. Watch mode is a separate `persistent` task. |
| **Prisma CLI / schema / migrations** | Prisma remains in `@sokosumi/database`. Turbo only orders `db:generate` / `db:migrate` relative to `build`/`dev`. Official Prisma+turbo example sets those prisma tasks `"cache": false`. |
| **Husky** | Listed as a **valid root** dependency (“tools for managing the repository”: `turbo`, `husky`, `lint-staged`). Pre-commit hook content is still a shell script (`pnpm precommit` here). |
| **Vercel project / Next runtime** | Vercel “zero-config” for turbo is about **Remote Cache + build command**, not replacing Next or the Vercel project. This repo already uses `pnpm install --filter web...` in `apps/web/vercel.json`, which is the official filtered-install recipe. |

Citations:

- [https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — “Turborepo does not manage dependencies”; “Few dependencies in the root”
- [https://turborepo.dev/docs/guides/frameworks/nextjs](https://turborepo.dev/docs/guides/frameworks/nextjs)
- [https://turborepo.dev/docs/guides/tools/biome](https://turborepo.dev/docs/guides/tools/biome) — “Using Biome with Turborepo”
- [https://turborepo.dev/docs/guides/tools/vitest](https://turborepo.dev/docs/guides/tools/vitest) — “Leveraging Turborepo for caching”
- [https://www.prisma.io/docs/guides/turborepo](https://www.prisma.io/docs/guides/turborepo) — `db:generate` / `db:migrate` / `db:deploy` `"cache": false`
- [https://turborepo.dev/docs/guides/ci-vendors/vercel](https://turborepo.dev/docs/guides/ci-vendors/vercel) — “Filtered installs”

---

## 4. Caching: local vs remote; inputs/outputs; misses; Next.js / Vercel

### Local cache

Default cache dir: `.turbo/cache` (gitignore `.turbo`). Cache holds **task file outputs** (globs in `outputs`) and **always** the task logs. Omitting `outputs` or passing `[]` caches **nothing except logs**.

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — “What gets cached?”; [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `outputs`, `cacheDir`

“Turborepo assumes that your tasks are **deterministic**. If a task is able to produce different outputs given the set of inputs that Turborepo is aware of, caching may not work as expected.”

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — callout under intro

Git worktrees share `.turbo/cache` with the main worktree unless `cacheDir` is set explicitly. Restored artifacts are **not** rewritten; absolute worktree paths inside outputs can point at another checkout.

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — “Git Worktree Cache Sharing”

### When a cache is a miss

Two hashes: **global** and **package/task**. Either changing → miss.

**Global hash inputs** (any of these miss **all** cacheable tasks): resolved `turbo.json` task definition; lockfile changes that affect the workspace root; source of internal packages the **root** `package.json` depends on; `globalDependencies` files; `globalEnv` values; behavior-changing flags (`--cache-dir`, `--framework-inference`, `--env-mode`); passthrough args after `--`.

**Package hash inputs:** package `turbo.json`; lockfile changes for that package; that package’s `package.json`; files in the package (default: all source-controlled files; overridable with `inputs`). Always hashed even if you try to ignore them: `package.json`, `turbo.json`, lockfiles.

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — “Task inputs”

Declaring `inputs` **opts out of default `.gitignore` following** unless you include `$TURBO_DEFAULT$`.

[https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `inputs`

Root-level dependency changes: “If you install too many dependencies in the root of your repository, you'll be changing the workspace root whenever you add, update, or delete a dependency, leading to unnecessary cache misses.” This repo already keeps almost only repo-management deps at root (`@biomejs/biome`, `husky`, …), which matches the official “few dependencies in the root” rule.

[https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — “Better caching ability”; “Few dependencies in the root”

### When official docs say caching is a **net loss**

Rare cases: task faster than a Remote Cache round-trip; output so large that upload/download exceeds regenerate time (example: a full Docker image); “Scripts that have their own caching” — “configuration can quickly become complicated to make Turborepo's cache and the application cache work together.”

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — “Caching a task is slower than executing the task”

Biome is called out as “so extraordinarily fast” that a Root Task is preferred; a root Biome task **misses for the whole repo** when Biome version or config changes.

[https://turborepo.dev/docs/guides/tools/biome](https://turborepo.dev/docs/guides/tools/biome) — “Using Biome with Turborepo”, “Caching behavior”

Just-in-Time internal packages have **no `build` script**, so “Turborepo cannot cache a build for a Just-in-Time Package.” This repo’s packages are compiled (`dist`), so they are the cacheable shape.

[https://turborepo.dev/docs/core-concepts/internal-packages](https://turborepo.dev/docs/core-concepts/internal-packages) — “Just-in-Time Packages” limitations

### Remote cache

Local-only by default. Without remote: “the same task (`turbo run build`) must be **re-executed on each machine** (by you, by your teammates, by your CI, by your PaaS, etc.) even when all of the task inputs are identical.”

“You don't have to use Remote Caching to use Turborepo. While Remote Caching will bring the most significant speedups, you can make your existing workflows faster without Remote Caching, too.”

[https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — intro + callout

Default provider: Vercel Remote Cache, “free to use on all plans, even if you do not host your applications on Vercel.” Self-host via HTTP API (`turbo login --manual`) or community servers.

Logs are artifacts: “be aware of what you are printing to the console.”

[https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — “A single, shared cache”; “Vercel”; “Self-hosting”

Vercel: artifacts expire after 7 days; fair-use caps (Hobby 100GB/month, Pro 1TB, Enterprise 4TB). Owner can clear the cache.

[https://vercel.com/docs/monorepos/remote-caching](https://vercel.com/docs/monorepos/remote-caching) — “Usage”, “Clear the Remote Cache”

### Next.js / Vercel interaction

Official Next `outputs`: `[".next/**", "!.next/cache/**", "!.next/dev/**"]`. `.next/cache` is **excluded** from turbo’s cache because it is Next’s own incremental cache.

[https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository) — Next.js `turbo.json` tab; [https://turborepo.dev/docs/guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) — example `turbo.json`

Next.js CI docs: persist `.next/cache` **separately** between CI builds. On Vercel, “Next.js caching is automatically configured.” If using Turborepo on Vercel, they point at the Vercel turborepo page.

[https://nextjs.org/docs/app/guides/ci-build-caching](https://nextjs.org/docs/app/guides/ci-build-caching) — “Vercel”

Vercel + turbo: if you run `turbo` during a Vercel build, “Remote Caching will be automatically enabled. No additional configuration is required.” Build command documented as `turbo run build` (≥1.8) or `cd ../.. && turbo run build --filter=web`. Global `turbo` on Vercel infers filter from Root Directory (`turbo build`).

[https://vercel.com/docs/monorepos/turborepo](https://vercel.com/docs/monorepos/turborepo) — “Import your Turborepo to Vercel”; “Using global `turbo`”; “Use Remote Caching during Vercel Build” on the Remote Caching page

**Skew Protection:** “Building a Next.js application that is using Skew Protection always results in a Turborepo cache miss” because the env var changes per deployment. CDN cache can still hit. Turbo &lt; 2.4.1 + Skew Protection: possible missing assets; docs “strongly recommend upgrading to Turborepo 2.4.1+.”

[https://vercel.com/docs/monorepos/turborepo](https://vercel.com/docs/monorepos/turborepo) — “Limitations”

Vercel Run Summary UI exists on deployments to debug cache misses (turbo ≥ 1.9).

[https://vercel.com/docs/monorepos/turborepo](https://vercel.com/docs/monorepos/turborepo) — “Unexpected cache misses”

This repo’s `apps/web/vercel.json` already sets `"installCommand": "pnpm install --filter web..."`, matching the official filtered-install snippet (pnpm ≥ 9.5 required; 8.x–9.4 `--filter` installed the whole workspace — pnpm#6300).

[https://turborepo.dev/docs/guides/ci-vendors/vercel](https://turborepo.dev/docs/guides/ci-vendors/vercel) — “Filtered installs”

---

## 5. `dependsOn` / task graph vs `pnpm -r --parallel`

Package manager workspace-run of `lint && build && test` is drawn in official docs as **sequential**, with empty cores. `turbo run lint build test` **parallelizes** independent work and only serializes along `dependsOn`.

[https://turborepo.dev/docs/crafting-your-repository/configuring-tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) — intro diagrams

`turbo run test lint` **equals** `turbo run lint test`. Ordering is **not** CLI argument order; it is `turbo.json`.

[https://turborepo.dev/docs/crafting-your-repository/running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) — “Running multiple tasks”

`--parallel` on `turbo run` is **deprecated**: “discards the task dependency graph, which means caching, ordering, and dependency-awareness are all lost.” Official migration: `persistent` + `with` for long-running dev; `--concurrency` for more parallelism.

[https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--parallel`

Default concurrency is `10` (not “all cores”). `100%` uses all logical processors. `1` forces serial.

[https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `concurrency`; [https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--concurrency`

This repo’s `dev` is `pnpm -r --parallel dev`. Official turbo `dev` is not `--parallel`; it is `"cache": false`, `"persistent": true`, optionally `"with": ["api#dev"]` so Core and web start together without depending on a process that never exits.

[https://turborepo.dev/docs/crafting-your-repository/developing-applications](https://turborepo.dev/docs/crafting-your-repository/developing-applications) — “Configuring development tasks”; [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `persistent`, `with`

`pnpm -r` without `--parallel` still walks the **package** graph (install-order / topological scripts). It does **not** express “typecheck waits on database **build**” or “test waits on build in the same package” unless you encode that in each script or with `&&` at root. That is the gap the hand-coded `database:build &&` and Core `build:workspace-deps` currently fill.

Transit nodes: typecheck can stay parallel **and** still miss cache when a dependency’s **source** changes, by depending on a no-op `transit`/`topo` task with `"dependsOn": ["^transit"]`. That is **source-awareness**, not “wait for `dist/`.” Compiled packages that export `dist` still need `^build` (or prisma generate) before typecheck/build of dependents.

[https://turborepo.dev/docs/crafting-your-repository/configuring-tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) — “Dependent tasks that can be run in parallel”; [https://turborepo.dev/docs/guides/tools/typescript](https://turborepo.dev/docs/guides/tools/typescript) — “Linting your codebase”

---

## 6. `--affected` / `--filter` vs pnpm `--filter`

### pnpm `--filter` (this repo)

Used for package identity: `pnpm --filter web build`, `pnpm --filter @sokosumi/database build`, `pnpm --filter "./packages/*" test:ci`. pnpm also has `--filter web...` (package + workspace dependencies), which this repo already uses in Vercel `installCommand`.

### turbo `--filter`

Same idea, extra syntax, documented as operating on the **Package Graph** by default (task-level is a future flag).

| Selector | Meaning |
| --- | --- |
| `--filter=ui` | Package name |
| `--filter=./apps/*` | Directory glob |
| `--filter=[HEAD^1]` | Git range (must be wrapped in `[]`) |
| `--filter=...ui` | Package **plus dependents** |
| `--filter=web...` | Package **plus dependencies** |
| `--filter=!docs` | Negate |
| `--filter=web#build` | Package-task id (also `turbo run web#lint`) |

Multiple `--filter` flags are a **union**. Combined with `--affected`, **both** constraints must match.

[https://turborepo.dev/docs/crafting-your-repository/running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) — “Using filters”; [https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--filter`

Automatic package scoping: `cd apps/docs && turbo build` scopes to that package’s graph. `--filter` overrides it. Vercel uses this with Root Directory.

[https://turborepo.dev/docs/crafting-your-repository/running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) — “Automatic Package Scoping”

`--only` drops `dependsOn` and dependency packages.

[https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--only`

### `--affected`

Default equivalent: `--filter=...[main...HEAD]`. In GitHub Actions, turbo reads `GITHUB_BASE_REF` (PRs) or `GITHUB_EVENT_PATH` (pushes). Override with `TURBO_SCM_BASE` / `TURBO_SCM_HEAD`.

Default is **package-level**: any file change in a package selects **all** of that package’s tasks. `futureFlags.affectedUsingTaskInputs` makes it **task-level** using each task’s `inputs`. Root `package.json` / `turbo.json` / lockfile / `globalDependencies` changes still select **everything**.

Shallow clone → all packages considered changed.

[https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--affected`; [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `affectedUsingTaskInputs`; [https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Using `--affected` in GitHub Actions”

Official note vs git `--filter`: “In general, you can rely on caching to keep your repository fast. When you're using Remote Caching, you can count on hitting cache for unchanged packages.” `--affected` is positioned as useful when **not** using Remote Cache, or in a large repo to cut network restore volume, or to replace bespoke git filters. It “falls back to running all tasks” on shallow clones, unlike a broken custom filter.

[https://turborepo.dev/docs/crafting-your-repository/running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) — “Filtering by source control changes”; [https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Running only affected tasks”

`turbo query affected --packages web` (and `--exit-code`) is the replacement for deprecated `turbo-ignore`, used to skip **CI setup** (install, container) not just the task.

[https://turborepo.dev/docs/guides/skipping-tasks](https://turborepo.dev/docs/guides/skipping-tasks)

Vercel Ignored Build Step: `turbo query affected --base=$VERCEL_GIT_PREVIOUS_SHA --packages <name> --exit-code`. Older Vercel table still shows `npx turbo-ignore --fallback=HEAD^1` (deprecated on the turbo side).

[https://vercel.com/docs/monorepos/turborepo](https://vercel.com/docs/monorepos/turborepo) — “Ignoring unchanged builds”

---

## 7. Remote cache: Vercel, self-hosted, GitHub Actions, secrets

### Vercel managed

- Local: `turbo login` then `turbo link`. SSO: `turbo login --sso-team=team-name`.
- Hosting the app on Vercel: remote cache “automatically set up … once you use `turbo`.”
- Not hosting on Vercel: still free on all Vercel plans; authenticate from CI.

[https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — “Vercel”; [https://vercel.com/docs/monorepos/remote-caching](https://vercel.com/docs/monorepos/remote-caching)

Optional artifact signing: `remoteCache.signature: true` + env `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (HMAC-SHA256). Failed signatures → miss. Docs: “This is not a security feature” — integrity against partial upload/download. `futureFlags.longerSignatureKey` enforces ≥ 32-byte keys.

[https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — “Artifact Integrity and Authenticity Verification”; [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `signature`, `longerSignatureKey`

### Self-hosted

Any HTTP server matching the Remote Cache API (`v8` endpoints; OpenAPI at `/docs/openapi`). `turbo login --manual` for API URL, team, token. Community: `brunojppb/turbo-cache-server`, `ducktors/turborepo-remote-cache`, `Tapico/tapico-turborepo-remote-cache`.

`remoteCache.apiUrl` / `loginUrl` default `"https://vercel.com"`. `teamId` must start with `team_` or is ignored.

[https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — “Remote Cache API”; [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `remoteCache`

### GitHub Actions env / secrets

| Variable | Role |
| --- | --- |
| `TURBO_TOKEN` | Bearer token for Remote Cache |
| `TURBO_TEAM` | Team slug (Vercel: the `acme` in `vercel.com/acme`) |

[https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Enabling Remote Caching”; [https://turborepo.dev/docs/guides/ci-vendors](https://turborepo.dev/docs/guides/ci-vendors) — “General Setup”

**OIDC (recommended):** Vercel team Settings → OIDC Policies for CLI Access → Turborepo CLI policy (GitHub account + repo). Repo **variable** `TURBO_TEAM` (not a secret, so logs don’t redact the team name). Job needs `permissions: { contents: read, id-token: write }`. Action `vercel/setup-turborepo-remote-cache-action@v1.0.0` with `team: ${{ vars.TURBO_TEAM }}` exchanges GitHub OIDC for a **short-lived** turbo token (cache-only, team-scoped, not a person). Multiple matching policies require passing `policy`.

**PAT (fallback):** Vercel account token scoped to the team. Repo **secret** `TURBO_TOKEN`. Same `TURBO_TEAM` variable. Job `env: TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}`, `TURBO_TEAM: ${{ vars.TURBO_TEAM }}`.

[https://turborepo.dev/docs/guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) — “Remote Caching with Vercel Remote Cache”; [https://vercel.com/docs/monorepos/remote-caching/external-ci-cd](https://vercel.com/docs/monorepos/remote-caching/external-ci-cd)

**Without Vercel Remote Cache:** `actions/cache@v4` on path `.turbo`, key `${{ runner.os }}-turbo-${{ github.sha }}`, restore-keys `${{ runner.os }}-turbo-`. This is a **per-runner GitHub cache**, not a shared org cache.

[https://turborepo.dev/docs/guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) — “Remote Caching with GitHub actions/cache”

`--cache=local:rw,remote:r` etc. controls read/write per source. Default `local:rw,remote:rw`.

[https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--cache`

This repo’s GHA setup action today: `pnpm/action-setup` + `actions/setup-node` `cache: pnpm` + `pnpm install`. No `TURBO_*`, no `.turbo` cache, no OIDC `id-token: write`.

---

## 8. Migration cost for a repo this shape

Official “add to existing” is **incremental**. “You don't have to start running *all* your tasks for *all* your packages using `turbo` right away.”

[https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository) — “Preparing a multi-package workspace”

Documented steps (already done vs still needed):

| Step | Official | This repo |
| --- | --- | --- |
| `pnpm-workspace.yaml` `apps/*` `packages/*` | Required | Present |
| Lockfile | Required | `pnpm-lock.yaml` |
| Root `package.json` `private: true` | Required | Present |
| Package-manager declaration | `devEngines.packageManager` or legacy `packageManager` | `"packageManager": "pnpm@11.22.0"` |
| Per-package `package.json` scripts | Turbo matches script **names** | `build` / `typecheck` / `test` / `dev` already exist |
| Install `turbo` root + optional global | `pnpm add turbo --save-dev --workspace-root` | Not present |
| Root `turbo.json` | Required | Not present |
| `.gitignore` `.turbo` | Required | Not present (would be new) |

[https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository) — steps 1–5; [https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — “Minimum requirements”

**Thin `turbo.json` path** (what official Next.js add-to-existing shows):

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "!.next/dev/**"]
    },
    "check-types": { "dependsOn": ["^check-types"] },
    "dev": { "persistent": true, "cache": false }
  }
}
```

[https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository) — Next.js tab

That example is **not** a complete map of this repo: compiled packages need `dist/**` outputs; Next is only `web`; Core is `tsup` `dist`; prisma generate is a separate uncached task in the Prisma guide; Biome is a Root Task (`//#check`) in the Biome guide; Vitest wants a non-watch `test` plus `test:watch` `persistent`; typecheck that consumes `dist` needs `^build` or `database#build`, not only `^check-types`.

**Root script rewrite vs keep `pnpm --filter` aliases:** official pattern is only overwrite the **fan-out** scripts (`build`, `test`, `dev`, `lint`) to `turbo run …`. “You only want to write `turbo` commands in your root `package.json`.” Per-package `web:dev`, `prisma:migrate:*`, `generate:core` can stay `pnpm --filter`. Writing `turbo` **inside a package’s** `package.json` causes recursive turbo (error in single-package; warned in multi).

[https://turborepo.dev/docs/crafting-your-repository/running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) — “Using `scripts` in `package.json`”; [https://turborepo.dev/docs/messages/recursive-turbo-invocations](https://turborepo.dev/docs/messages/recursive-turbo-invocations)

Nx migration guide (the only official “from another orchestrator” doc) also says keep both tools during incremental cutover: one task at a time, one package at a time, or double-run.

[https://turborepo.dev/docs/guides/migrating-from-nx](https://turborepo.dev/docs/guides/migrating-from-nx) — “Migrate complex monorepos incrementally”

Husky: official root-deps list includes husky. This repo’s hook is `pnpm precommit` → `pnpm check && pnpm typecheck`. If those names become `turbo run` Root Tasks, the hook would pick them up without a hook rewrite; if they stay `biome check .` at root, turbo is optional for precommit.

[https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — “Few dependencies in the root”

Pin global turbo in CI to the **major** of the repo-pinned `turbo` because CI may run `turbo` before `pnpm install`.

[https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Global `turbo` in CI”

Use `turbo run` (not bare `turbo`) in CI to avoid future subcommand collisions.

[https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Use `turbo run` in CI”

---

## 9. Known pitfalls (official)

### Environment variables as cache keys

Failing to list env vars that affect output “can result in shipping your application with the wrong configuration. This can cause serious issues like shipping your preview deployments to production.”

[https://turborepo.dev/docs/crafting-your-repository/using-environment-variables](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables) — opening error callout

- `env` / `globalEnv`: **hashed**. Change → miss.
- `passThroughEnv` / `globalPassThroughEnv`: available at runtime in Strict mode, **not hashed**.
- Default `envMode` is `"strict"`: only listed vars (+ framework inference prefixes) reach the task. Unlisted CI vars are stripped until added.
- Loose mode (`--env-mode=loose`) makes all env available **without** hashing them — official preview-URL-baked-into-production example.
- Framework inference for Next.js auto-includes `NEXT_PUBLIC_*` per package. Other vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, Stripe, Ably, …) must be listed if they affect the task. This repo’s `build.yml` already injects a long list of CI placeholder env; under Strict mode those would be **invisible** to `next build` / `tsup` unless declared.
- `.env` files are **not loaded by turbo**. Hash them via `inputs` / `globalDependencies` (`".env*"`). Framework or dotenv loads them.
- Inline `export FOO=1 && next dev` in a script is **after** hash time — turbo will not see `FOO`.
- Env used by a JIT dependency that has no `build` task must be declared on the **consumer**.
- Vercel platform env is checked against `turbo.json`; disable with `TURBO_PLATFORM_ENV_DISABLED=true`.

[https://turborepo.dev/docs/crafting-your-repository/using-environment-variables](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables) — all subsections; [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `envMode`, `env`, `globalEnv`

This repo’s GHA `build.yml` env includes `NEXT_PUBLIC_NETWORK` (covered by Next inference) and many non-prefixed secrets/placeholders (not inferred).

### Non-deterministic outputs

Determinism assumption: same inputs → same outputs. Cache hit with missing files → `outputs` globs wrong. Cache hit with wrong env → `env`/`globalEnv` missing.

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — determinism callout; [https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Troubleshooting”

`--summarize` writes `.turbo/runs` JSON to diff two hashes (which inputs changed). `--dry` / `--dry=json` shows the graph without running. `--force` re-executes but still **writes** cache.

[https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — “Troubleshooting”

### Watch / `dev` tasks

`dev`: `"cache": false`, `"persistent": true`. Persistent tasks must not be `dependsOn` targets (they never exit). Use `with` for sibling long-running processes.

`turbo watch` re-runs on file changes. Persistent tasks ignored unless `"interruptible": true`. Watch caching is **experimental** (`--experimental-write-cache`). Task outputs that are **git-tracked** can infinite-loop watch; docs: take those outputs out of git.

Turbo cannot run teardown scripts on Ctrl-C; make a separate `dev:teardown` task.

[https://turborepo.dev/docs/crafting-your-repository/developing-applications](https://turborepo.dev/docs/crafting-your-repository/developing-applications); [https://turborepo.dev/docs/reference/watch](https://turborepo.dev/docs/reference/watch); [https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — `persistent`, `interruptible`, `with`

### Prisma generate

Official Prisma+turbo guide: `db:generate` / `db:migrate` / `db:deploy` all `"cache": false`. `build` and `dev` `dependsOn: ["^db:generate"]`. `globalEnv: ["DATABASE_URL"]`. Prisma 7: `migrate dev` does **not** run `generate` automatically.

[https://www.prisma.io/docs/guides/turborepo](https://www.prisma.io/docs/guides/turborepo) — “2.3. Add scripts and run migrations”; “4. Configure task dependencies”

This repo: `@sokosumi/database` `prepare` is `prisma generate && build`; Core `prepare`/`prebuild` call `build:workspace-deps` which includes `prisma:generate`. If turbo caches `build` without hashing generated client inputs (or without a prior uncached generate), dependents can restore stale client. Deferred hashing (`inputs` `mode: "jit"`) exists for files produced by an earlier task in the same run.

[https://turborepo.dev/docs/reference/configuration](https://turborepo.dev/docs/reference/configuration) — “Deferred hashing”

### Husky

Not a turbo-specific footgun in official docs. Root `husky` is recommended. Risk in *this* repo is runtime cost: precommit already runs full `biome check` + `typecheck` (which currently builds database first). Making typecheck a cached turbo task would change **repeat** precommit cost on unchanged inputs; first run still pays full price. Official does not discuss husky+turbo beyond listing husky as a root tool.

[https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — “Few dependencies in the root”

### Recursive `turbo`

Root scripts call `turbo run X`. Package scripts must **not** call `turbo`. Missing `pnpm-workspace.yaml` makes turbo treat the repo as single-package and then error on ` "build": "turbo run build" `.

[https://turborepo.dev/docs/messages/recursive-turbo-invocations](https://turborepo.dev/docs/messages/recursive-turbo-invocations)

### Nested packages

`apps/**` / `packages/**` nested packages (`apps/a` and `apps/a/b`) are **unsupported**.

[https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — error callout under “Declaring directories for packages”

### TypeScript Project References

“We don't recommend using TypeScript Project References” with turbo — extra config + extra cache layer.

[https://turborepo.dev/docs/guides/tools/typescript](https://turborepo.dev/docs/guides/tools/typescript) — “You likely don't need TypeScript Project References”

### Vitest Projects vs per-package

Root Vitest Projects: “you can't rely on Turborepo's caching” because there are no package boundaries; a Root Task `//#test` misses on **any** package change. Official preference for cache: per-package `vitest run` + turbo `test` task. Merged coverage then needs a custom blob-merge script.

[https://turborepo.dev/docs/guides/tools/vitest](https://turborepo.dev/docs/guides/tools/vitest) — both strategies

This repo already uses per-package Vitest (`apps/web`, `apps/core`, `packages/*`) plus a GHA matrix — the shape turbo’s cacheable path assumes.

### Next.js Skew Protection

Always a turbo cache miss on Vercel when Skew Protection is on (env changes every deploy).

[https://vercel.com/docs/monorepos/turborepo](https://vercel.com/docs/monorepos/turborepo) — “Limitations”

### Logs contain secrets

Remote cache stores logs. `--json` “captures **all** task output verbatim.”

[https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — responsibility callout; [https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--json`

---

## 10. When official docs say not to adopt / when pnpm recursive is enough

There is **no** official page titled “don’t use Turborepo” or “pnpm recursive is enough.” Closest first-party statements:

1. **Turbo is optional on top of the workspace you already have.** It does not replace pnpm. If the pain is install/link/versioning, that stays pnpm.

   [https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — “Turborepo does not manage dependencies”

2. **Remote Cache is optional.** Local cache still speeds a **single** machine. Without remote, CI still re-executes identical work on every runner.

   [https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — “You don't have to use Remote Caching”

3. **Do not cache some tasks:** faster than a cache round-trip; enormous artifacts; tools with their own cache (Next `.next/cache` is explicitly excluded from turbo outputs for this reason).

   [https://turborepo.dev/docs/crafting-your-repository/caching](https://turborepo.dev/docs/crafting-your-repository/caching) — “Caching a task is slower than executing the task”

4. **Biome:** split-per-package turbo tasks are *allowed* but not the default recommendation because Biome is already fast; this repo already uses the recommended Root `biome check .`.

   [https://turborepo.dev/docs/guides/tools/biome](https://turborepo.dev/docs/guides/tools/biome)

5. **Incremental:** official add-to-existing says you can turbo **one task** (e.g. only `build`) and leave `pnpm -r test` as-is.

   [https://turborepo.dev/docs/getting-started/add-to-existing-repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository)

6. **`--parallel` is the wrong tool** to emulate `pnpm -r --parallel` for cacheable work; it throws away the graph. For `dev`, use `persistent` instead.

   [https://turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run) — `--parallel`

7. **Constructing CI starting advice:** “Rely on caching” + `turbo run lint check-types test` for the whole repo, `turbo build --filter=web` for the app. `--affected` is for when you are *not* using Remote Cache, or the repo is large enough that restoring every cached task is itself slow.

   [https://turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — “Best practices” / “Rely on caching”

Official diagrams contrast package-manager `workspaces run A && run B && run C` (serial) with `turbo run A B C` (scheduled). They do **not** quantify a break-even package count. This workspace is 2 apps + 7 packages — inside the shape of `create-turbo` examples (2 apps + a handful of libraries).

[https://turborepo.dev/docs/getting-started/installation](https://turborepo.dev/docs/getting-started/installation) — starter contents; [https://turborepo.dev/docs/crafting-your-repository/configuring-tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) — serial vs turbo diagrams

---

## 11. Alternatives mentioned by official turbo docs

| Alternative | How official docs mention it |
| --- | --- |
| **pnpm / yarn / npm / bun workspaces** | The substrate turbo requires. Not an alternative *to* turbo; turbo is layered on them. |
| **Nx** | Full migration guide. Motivation claimed for switching *to* turbo: ecosystem standards (package.json workspaces vs plugins), less Nx-specific config, “greater control of source code.” Equivalence tables: `nx run`/`run-many` → `turbo run`; `--projects` → `--filter`; `sharedGlobals` → `globalDependencies`; etc. Incremental: run both. |
| **Vercel Remote Cache SDK** | Same remote cache used by **Nx** and **Rush** via `@vercel/remote-cache` plugins — i.e. you can use Vercel’s cache without turbo. |
| **GitHub `actions/cache`** | Alternative to Vercel Remote Cache for storing `.turbo` on GHA runners. |
| **Self-hosted remote cache servers** | Three community HTTP implementations listed. |
| **Bazel, Buck, Please, Pants, Scoot, Lerna, Lage, Backfill, Bolt, Rush, Preconstruct, Yarn, npm, pnpm** | Acknowledgements “inspiration and prior art” only — no comparison tables. |
| **`turbo-ignore`** | Deprecated; replaced by `turbo query affected`. |
| **Vitest Projects / Jest workspaces** | Alternative *test runner topology*; official says they fight package-boundary caching. |
| **TypeScript Project References** | Explicitly **not** recommended with turbo. |
| **syncpack / manypkg / sherif / pnpm catalogs** | Dependency-version alignment — package-manager concern, not turbo. |

Citations:

- [https://turborepo.dev/docs/guides/migrating-from-nx](https://turborepo.dev/docs/guides/migrating-from-nx) — “Why switch?”, “Configuration equivalents”, “CLI equivalents”
- [https://vercel.com/docs/monorepos/remote-caching](https://vercel.com/docs/monorepos/remote-caching) — Remote Cache SDK for Nx and Rush
- [https://turborepo.dev/docs/guides/ci-vendors/github-actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) — `actions/cache`
- [https://turborepo.dev/docs/core-concepts/remote-caching](https://turborepo.dev/docs/core-concepts/remote-caching) — community implementations
- [https://turborepo.dev/docs/acknowledgments](https://turborepo.dev/docs/acknowledgments) — “Inspiration and Prior Art”
- [https://turborepo.dev/docs/guides/skipping-tasks](https://turborepo.dev/docs/guides/skipping-tasks) — `turbo-ignore` deprecated
- [https://turborepo.dev/docs/guides/tools/vitest](https://turborepo.dev/docs/guides/tools/vitest)
- [https://turborepo.dev/docs/guides/tools/typescript](https://turborepo.dev/docs/guides/tools/typescript) — Project References
- [https://turborepo.dev/docs/crafting-your-repository/managing-dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — syncpack / catalogs

The docs index (`llms.txt`, fetched 2026-08-20) has **Migrating from Nx** and no “Migrating from pnpm recursive,” “Migrating from Lerna,” or “Turbo vs Nx comparison” page. URL `https://turborepo.dev/docs/guides/migrating-from-other-tools` is listed in some nav copy but returned empty at fetch time; the live migration guide is Nx-only.

---

## Repo-shaped facts vs official primitives (index)

| This repo | Official primitive |
| --- | --- |
| `pnpm -r build` | `turbo run build` + `dependsOn: ["^build"]` + `outputs` |
| `pnpm -r --parallel dev` | `turbo run dev` + `cache: false` + `persistent: true` (not `--parallel`) |
| `pnpm database:build && pnpm -r typecheck` | `typecheck.dependsOn` includes `^build` and/or `database#build` |
| Core `build:workspace-deps` chain | Package graph + `^build` + `^db:generate` |
| Root `biome check .` | Root Task `//#check` (Biome guide default) |
| Per-package Vitest + GHA matrix | Per-package `test` task; matrix optional if using cache/`--affected` |
| GHA pnpm store cache only | Optional `.turbo` `actions/cache` and/or `TURBO_TOKEN`/`TURBO_TEAM` |
| `apps/web/vercel.json` `pnpm install --filter web...` | Official Vercel filtered install; turbo Remote Cache auto if build command is `turbo` |
| Husky `pnpm check && pnpm typecheck` | Unchanged hook surface; tasks may become `turbo run` |
| Compiled `dist` packages + prisma generate in `prepare` | Compiled-package strategy + uncached `db:generate` before `build`/`dev` |
