# Architecture and implementation rules

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

## Tech Stack & Architecture

**Core Stack**: Next.js 16 (App Router), React 19.3, TypeScript, pnpm workspace, Node.js 24.x  
**Task runner**: Turborepo (`turbo.json`) orchestrates `build` / `typecheck` / `test`. pnpm remains the package manager. Do not restore app-level `prebuild` or Core `build:workspace-deps` — the graph is `dependsOn` in `turbo.json`. Per-package `prepare` still emits `dist` for Vercel filtered installs, except `@sokosumi/database`, which has no build at all — Core consumes its source and bundles it ([ADR 0035](../../docs/adr/0035-database-consumed-from-source.md)); its Prisma client comes from turbo `prisma:generate` on local machines and in CI, and from Core `vercel-build` on Vercel. `dev` and Biome stay outside turbo. See [ADR 0008](../../docs/adr/0008-turbo-task-runner-on-pnpm.md).
**Web Architecture**: Three-layer pattern with services (`src/lib/services/`) coordinating domain flows and actions (`src/lib/actions/`) exposing typed server mutations. Web reaches data **only through the Core API** — it never touches Prisma/Postgres directly (see [Database Access](#database-access)).
**API Architecture**: Hono with OpenAPI validation and standardized response helpers. Core owns all database access via Prisma (`@sokosumi/database`). New Core routes use direct Prisma; repositories remain for some legacy Core services. Web never touches the DB.
**Styling**: Tailwind CSS + shadcn/ui + Radix UI primitives
**Auth**: Better Auth with organization-aware sessions
**i18n**: next-intl for internationalization

### Code Changes

When several approaches fit, facts in the root AGENTS.md and these referenced instructions win over a shortcut.

Delete obsolete callers, branches, flags, and shims. Do not keep two paths. Prisma migrations, Core OpenAPI plus web client regen, and API versioning still apply when stored data or a released contract changes. Do not add silent dual-read or dual-write layers.

Build the smallest thing that satisfies the current requirement. No knobs or extension points for work that is not real yet. Ship a thin end-to-end slice first. Do not replace a working product with a half-built framework.

Put logic at the right layer. Web UI, actions, and services. Core routes. Shared packages. Do not smuggle domain rules across those boundaries to save a file.

**Reuse existing.** Before adding a helper, module, wrapper, package, or parallel path, search this repository for an existing implementation that already does the job: a package, SDK, service, UI primitive, helper, or env/config pattern. State the candidates you considered and why each fits or does not before writing the new path.

Use the existing API. If it almost fits, extend it in place. If the change would create a second copy, extract or share from the existing one. Write new only when those named candidates do not fit because they are absent, sit at the wrong layer, or extending them would break the existing seam.

Pin registry versions ([pinned-dependencies](../../.cursor/rules/pinned-dependencies.mdc)). Use `workspace:*` instead of copying logic.

Keep a design you would still want in six months. A stopgap needs an explicit hotfix scope and a tracked follow-up.

If two keepable options remain, pick the one that matches existing patterns, names things for what they mean today, and does not leave dead parameters, branches, or comments.

| Short-term win | Maintainable choice |
| --- | --- |
| Reuse a positional arg slot for a new meaning | Named options object or explicit parameter |
| Copy-paste to ship faster | Shared helper or package when logic is duplicated |
| Leave a stub, TODO, or partial removal "for later" | Finish the removal or scope the PR honestly |
| One-off hack around architecture | Fix at the right layer (Core, shared package, schema) |
| Skip renaming because the diff is bigger | Rename when the old name is now misleading |

A shortcut is fine when the user asked for the smallest change, when a hotfix has a tracked follow-up, or when expanding a bugfix would balloon into a refactor. Removing a feature means removing its types, routes, UI, migrations, and tests. If you touch a misleading API, rename it in the same change.

- Follow the three-layer architecture pattern
- Minimize `'use client'` usage; prefer Server Components and server actions
- At the end of every sequence of changes, run a review pass, fix any issues found, and repeat until no issues remain

### Generated Files

- **Never hand-edit generated files.** Auto-generated artifacts (files marked `This file is auto-generated`, anything under `src/lib/clients/generated/`, Prisma client output, etc.) must remain exactly as their generator produces them. Hand-applied edits silently regress on the next regeneration.
- **Fix the source, then regenerate.** To change generated output, edit the upstream source of truth (e.g. the Core Zod/OpenAPI schemas under `apps/core/src/schemas/`) and re-run the generator (e.g. `pnpm --filter web generate:core:snapshot` for the Core API client). Commit the regenerated files as-is.
- If a generated file looks wrong, the bug is in the generator input or config — chase it there, not in the output.

### Shared Packages and Deduplication

- **When logic is duplicated across apps** (e.g. core and web): move the implementation to a shared package (e.g. `packages/utils`) so there is a single source of truth; fix bugs and add features in one place.
- **Prefer direct imports** from the shared package (`@sokosumi/utils`, `@sokosumi/database`, etc.). Do not add re-export-only layers—see [avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc).
- **`packages/utils`** holds framework-agnostic helpers (URL/file utilities, markdown link extraction, user-name helpers, client-safe billing types/parsers). Add new shared helpers here when multiple apps or packages would use them. Web must not import `@sokosumi/database` (including `/helpers`)—see [utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc).

### Database Access

> [!IMPORTANT]
> **Direct database access from `apps/web` is forbidden.** All database reads and writes MUST be implemented in `apps/core` and exposed as Core API endpoints. The web app consumes data exclusively through the generated Core API client — never through Prisma, Postgres, or `@sokosumi/database` repositories.

- **Forbidden in `apps/web`**: importing `@sokosumi/database` repositories/helpers, instantiating or calling the Prisma client, or issuing raw SQL. Web services (`src/lib/services/`) and actions (`src/lib/actions/`) coordinate domain flows but obtain their data by calling Core endpoints.
- **Required in `apps/core`**: every new data-access need is implemented as a versioned route under `apps/core/src/routes/v1/`, using direct Prisma (legacy services may still use `@sokosumi/database/repositories`), validated with the Core Zod/OpenAPI schemas (`apps/core/src/schemas/`).
- **Web → Core wiring**: after adding/changing a Core endpoint, regenerate the Core API client (`pnpm --filter web generate:core:snapshot`), then run `pnpm --filter web typecheck` (or `pnpm web:typecheck`) to catch DTO drift. Do not chain typecheck into the generate script. Call regenerated endpoints from the web service layer. Do not hand-edit the generated client—see [Generated Files](#generated-files).
- **Web DTO boundary**: do not import `@sokosumi/database` or domain enum **values** from `@sokosumi/utils` in web — use the generated Core client. Details and approved utils exceptions live in `apps/web/AGENTS.md` (Core DTO boundary).
- **Why**: a single owner for data access keeps authorization, validation, and schema invariants in one place, lets the web app stay a thin client, and removes Prisma/Postgres credentials from the web runtime.
