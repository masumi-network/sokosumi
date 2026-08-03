# Sokosumi Agent Guidelines

> **Purpose**: This document provides comprehensive guidelines for AI agents working on the **Sokosumi monorepo** (apps, shared packages, tooling). It is not app-specific. For scoped guidance, see [`apps/web/AGENTS.md`](./apps/web/AGENTS.md), [`apps/core/AGENTS.md`](./apps/core/AGENTS.md), [`packages/database/AGENTS.md`](./packages/database/AGENTS.md), [`packages/masumi/AGENTS.md`](./packages/masumi/AGENTS.md), and [`packages/email/AGENTS.md`](./packages/email/AGENTS.md).

## Tech Stack & Architecture

**Core Stack**: Next.js 16 (App Router), React 19.2, TypeScript, pnpm workspace, Node.js 24.x  
**Web Architecture**: Three-layer pattern with services (`src/lib/services/`) coordinating domain flows and actions (`src/lib/actions/`) exposing typed server mutations. Web reaches data **only through the Core API** — it never touches Prisma/Postgres directly (see [Database Access](#database-access)).
**API Architecture**: Hono with OpenAPI validation and standardized response helpers. Core owns all database access via Prisma (`@sokosumi/database`). New Core routes use direct Prisma; repositories remain for some legacy Core services. Web never touches the DB.
**Styling**: Tailwind CSS + shadcn/ui + Radix UI primitives
**Auth**: Better Auth with organization-aware sessions
**i18n**: next-intl for internationalization

## Project Layout

```
sokosumi/
├── apps/
│   ├── web/                   # Next.js web application
│   │   ├── src/app/           # App Router routes, server actions, API handlers
│   │   ├── src/components/    # Shared UI components
│   │   ├── src/hooks/         # Custom React hooks
│   │   ├── src/contexts/      # React contexts
│   │   ├── src/lib/           # Domain logic (services, actions, utilities)
│   │   │   ├── services/      # Business logic coordination
│   │   │   ├── actions/       # Server mutations
│   │   │   └── utils/         # Helper functions and transformers
│   │   ├── __tests__/         # Colocated tests
│   │   ├── __mocks__/         # Reusable test doubles
│   │   ├── public/            # Static assets
│   │   └── messages/          # Translation catalogs
│   └── core/                  # Hono API service
│       ├── src/routes/v1/     # API route handlers (versioned)
│       ├── src/middleware/    # Request middleware (auth, etc.)
│       ├── src/helpers/       # Response and error helpers
│       ├── src/schemas/       # Zod validation schemas
│       └── src/lib/           # Shared utilities
├── packages/
│   ├── database/              # Shared database layer (@sokosumi/database)
│   │   ├── src/repositories/  # Prisma/Postgres access layer
│   │   ├── src/helpers/       # Database domain logic
│   │   ├── src/types/         # Database type definitions
│   │   └── prisma/            # Database schema and migrations
│   ├── masumi/                # Masumi protocol utilities (@sokosumi/masumi)
│   │   ├── src/clients/       # Agent API client
│   │   ├── src/hash/          # Hash utilities for job verification
│   │   ├── src/schemas/       # Agent protocol Zod schemas
│   │   └── src/types/         # Agent types
│   ├── utils/                 # Shared utilities (@sokosumi/utils)
│   │   └── src/               # URL/file helpers, markdown link extraction, user-name, etc.
│   ├── net/                   # Network helpers (@sokosumi/net; SSRF-safe fetch, etc.)
│   ├── email/                 # Shared email renderers and locales (@sokosumi/email)
│   ├── chat/                  # Chat types and shared chat utilities (@sokosumi/chat)
│   └── ai-provider/           # Sokosumi AI SDK provider (@sokosumi/ai-provider)
├── docs/                      # Agent, domain, coworker, and design docs
└── biome.jsonc                # Root Biome configuration
```

## Authoritative Conventions

### UI & Styling

- **Components**: Use Shadcn UI and Radix UI primitives
- **Styling**: Tailwind CSS with responsive design
- **Colors**: Use semantic colors from `globals.css`; never hardcode hex values
- **Sizing**: Use `size-4` instead of `h-4 w-4`
- **Themes**: Ensure compatibility with both dark and light modes

### TypeScript Usage

- **Mandatory**: Use TypeScript for all code
- **Interfaces**: Prefer interfaces over types
- **Enums**: Avoid enums; use maps instead
- **Components**: Use functional components with TypeScript interfaces
- **Inference**: Leverage Prisma type inference when possible
- **Type assertions**: Avoid `as unknown as X` double casts and `as any`; they discard type safety and hide bugs. Prefer typed APIs, type guards, or schema validation. Reach for a single `as` only to narrow a known-safe type (e.g. auth context).

### Key Conventions

- **URL State**: Use `nuqs` for URL search parameter state management
- **Client Components**: Limit `'use client'` usage
  - Favor server components and Next.js SSR
  - Use only for Web API access in small components
  - Avoid for data fetching or state management
- **Async Operations**: Use Suspense for async operations
- **Data Fetching**: Follow Next.js docs for Data Fetching, Rendering, and Routing

### Naming & Patterns

- **Components**: PascalCase (e.g., `UserProfile`)
- **Types/Interfaces**: PascalCase (e.g., `UserData`)
- **Functions**: camelCase (e.g., `getUserData`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `API_BASE_URL`)
- **Directories**: kebab-case (e.g., `user-profile`)
- **Prisma Models**: Singular (e.g., `User`, not `Users`)
- **Event Handlers**: Prefix with `handle` (e.g., `handleSubmit`)
- **Exports**: Prefer named exports
- **Functions**: Use `function` keyword for pure functions

### Code Style

- **Indentation**: Two spaces, semicolons enforced by Biome
- **Formatting**: Run `pnpm format` after substantial edits
- **Imports**: Relative within features, use aliases (`@/lib/*`) otherwise
- **Components**: Default to Server Components; add `'use client'` only for browser APIs

### Linting & Formatting

#### Biome Configuration

The monorepo uses a shared Biome configuration at the repo root (`biome.jsonc`). Each app and package that Biome should cover also has a `biome.json` with `"extends": "//"` so nested projects inherit that root config (see [Biome: big projects / monorepos](https://biomejs.dev/guides/big-projects/)).

`@biomejs/biome` is a **root-only** `devDependency`. Root-level and workspace scripts all invoke `biome …` the same way; `pnpm run` puts `node_modules/.bin` on `PATH`, so the hoisted `@biomejs/biome` binary is used for full-repo commands (`pnpm check`, `pnpm lint`, `pnpm format`, …) and for per-package scripts without duplicating the dependency in each workspace package.

**Import Organization**:

- `pnpm check` runs a repo-wide `biome check`, which enforces linting, formatting, and import organization
- `pnpm lint` runs a repo-wide `biome lint`, which checks lint rules only
- Unused imports are reported and can be auto-fixed by Biome

**TypeScript Rules**:

- Unused variables/arguments should be prefixed with `_` when intentionally unused
- Applies to variables, function arguments, caught errors, and destructured arrays

**Example of valid unused variable patterns**:

```typescript
function handler(_req, res) {
  // unused req parameter
  const [first, _second] = array; // unused destructured value
  try {
    doSomething();
  } catch (_error) {
    // unused error
    return fallback;
  }
}
```

#### Formatting Configuration

All code must follow these formatting rules:

- **Indentation**: 2 spaces (never tabs)
- **Semicolons**: Required
- **Quotes**: Double quotes (not single)
- **Trailing Commas**: Required in multi-line structures
- **Auto-fix**: Run `pnpm format`

**Example**:

```typescript
const config = {
  name: "example",
  items: [1, 2, 3],
};
```

#### Common Linter Fixes

| Error                               | Solution                          |
| ----------------------------------- | --------------------------------- |
| `lint/correctness/noUnusedImports`  | Remove import or use it           |
| `assist/source/organizeImports`     | Run `pnpm check:write` or `pnpm format` |

## Environment & Tooling

### Dependencies

- **Pin exact versions** for all external npm packages in workspace `package.json` files (no `^`, `~`, `>=`, or `*` ranges). Use `workspace:*` only for monorepo-internal packages. See [Pinned dependencies](.cursor/rules/pinned-dependencies.mdc).

### Prerequisites

- Node.js 24.x
- pnpm package manager

### Setup

1. Run `pnpm install` at repo root
2. Copy `apps/web/.env.example` to `apps/web/.env`
3. Copy `apps/core/.env.example` to `apps/core/.env`
4. Bootstrap database: `pnpm prisma:migrate:dev`
5. Generate Prisma clients: `pnpm prisma:generate`

### Git hooks

Husky runs `pnpm precommit` (`pnpm check && pnpm typecheck`) before each commit. Expect roughly 10–15 seconds. Skip with `git commit --no-verify` or `HUSKY=0`.

## Commands

| Command                | Purpose                       |
| ---------------------- | ----------------------------- |
| `pnpm install`         | Install dependencies          |
| `pnpm dev`             | Watch all workspace packages  |
| `pnpm web:dev`         | Run web app dev server        |
| `pnpm core:dev`        | Run core API dev server       |
| `pnpm build`           | Build for production          |
| `pnpm web:build`       | Build web app for production  |
| `pnpm core:build`      | Build core API for production |
| `pnpm web:start`       | Smoke test production build   |
| `pnpm lint`            | Run Biome lint across the repo (`biome lint .`) |
| `pnpm check`           | Run full Biome checks across the repo (`biome check .`) |
| `pnpm format`          | Format entire repo with Biome (`biome format --write .`) |
| `pnpm format:check`    | Check formatting for entire repo (`biome format .`) |
| `pnpm web:lint`        | Run Biome lint rules for the web app |
| `pnpm web:check`       | Run full Biome checks for the web app |
| `pnpm test`            | Run tests locally             |
| `pnpm core:test`       | Run core API tests            |
| `pnpm web:test`        | Run web app tests             |
| `pnpm masumi:test`     | Run masumi package tests      |
| `pnpm web:test:ci`     | CI test execution             |
| `pnpm web:format`      | Format web app code with Biome |
| `pnpm database:format` | Format database package code  |

## Testing Guidelines

- **Framework**: Vitest with Testing Library and workspace-specific environments (for example `happy-dom` in `apps/web` and Node in packages and `apps/core`)
- **Test Files**: Name as `*.test.ts(x)` and colocate under nearest `__tests__/`
- **Coverage**: Cover both success and failure paths when touching `src/lib`
- **Mocking**: Use `__mocks__` or Prisma factories for external services
- **Execution**: Run `pnpm test` from the repo root, or the relevant workspace command such as `pnpm --filter web test`, before pushing
- **Targeted reruns**: Use `pnpm --filter <workspace> test path/to/file.test.ts`. Do not insert an extra `--` before the file path for Vitest reruns.

## Commit & Pull Request Guidelines

### Commits

Follow [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) syntax:

```
feat(auth): add refresh token (#1234)
fix(ui): resolve button alignment issue
docs(readme): update setup instructions
```

### Branches

- **Linear issues**: When implementing a Linear issue, the branch name MUST start with the issue identifier (lowercased), followed by a short kebab-case description. For example, for `SOK-555` name the branch `sok-555-xxx-xxx-xxx`. Prefer the `gitBranchName` Linear provides for the issue when available.

### Pull Requests

> [!IMPORTANT]
> **PR titles MUST follow [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) syntax — this is enforced by the `Validate PR Title` CI check and a non-conforming title will fail the build.** This applies to *every* PR title, including ones auto-generated by AI/cloud agents (e.g. the Claude Code "Create PR" flow).
>
> **Set the PR title to the primary commit's subject line verbatim** — it is already a Conventional Commit. Do NOT invent a new descriptive sentence or rely on a generated summary; that is what produces non-conforming titles. If you create or rename a PR, set the title yourself in this format.
>
> **Format**: `type(optional-scope): description` (lowercase `type`, no trailing period).
>
> **Allowed types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
>
> | ✅ Valid | ❌ Invalid |
> | --- | --- |
> | `feat(core): add agent rating read endpoints for web` | `Add endpoint for fetching authenticated user's agent review` |
> | `fix(admin): remove duplicate Organization header` | `Remove duplicate Organization header` |
> | `feat(auth): add refresh token` | `Make FormSection title optional` |
> | `chore(deps): pin biome version` | `Update deps` |

- **Draft by default**: Open new PRs as **draft** unless the author explicitly asks for a ready-for-review PR. Mark it ready for review only once CI is green and the change is complete.
- **Title**: Follow [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) syntax (e.g. `feat(auth): add refresh token`)
- **Description**: Explain user-facing impact
- **Links**: Reference Linear or GitHub issues
- **Verification**: List steps (e.g., `pnpm test`, `pnpm build`)
- **Screenshots**: Attach for UI updates
- **Schema Changes**: Flag migration filenames and mention data scripts (`pnpm data-migration:<name>`)

## Agent Operating Rules

### Status Updates

- Provide clear status updates during long-running tasks
- Use todo lists for complex multi-step tasks
- Mark tasks as complete immediately after finishing

### Code Changes

- **Prioritize maintainability** over short-term wins — see [maintainability](.cursor/rules/maintainability.mdc)
- Prefer editing existing files over creating new ones
- Use semantic search to understand codebase before making changes
- Follow the three-layer architecture pattern
- Minimize `'use client'` usage; prefer Server Components and server actions
- At the end of every sequence of changes, run a review pass, fix any issues found, and repeat until no issues remain

### Generated Files

- **Never hand-edit generated files.** Auto-generated artifacts (files marked `This file is auto-generated`, anything under `src/lib/clients/generated/`, Prisma client output, etc.) must remain exactly as their generator produces them. Hand-applied edits silently regress on the next regeneration.
- **Fix the source, then regenerate.** To change generated output, edit the upstream source of truth (e.g. the Core Zod/OpenAPI schemas under `apps/core/src/schemas/`) and re-run the generator (e.g. `pnpm --filter web generate:core:snapshot` for the Core API client). Commit the regenerated files as-is.
- If a generated file looks wrong, the bug is in the generator input or config — chase it there, not in the output.

### Shared Packages and Deduplication

- **When logic is duplicated across apps** (e.g. core and web): move the implementation to a shared package (e.g. `packages/utils`) so there is a single source of truth; fix bugs and add features in one place.
- **Prefer direct imports** from the shared package (`@sokosumi/utils`, `@sokosumi/database`, etc.). Do not add re-export-only layers—see [avoid re-exports](.cursor/rules/avoid-re-exports.mdc).
- **`packages/utils`** holds framework-agnostic helpers (URL/file utilities, markdown link extraction, user-name helpers, client-safe billing types/parsers). Add new shared helpers here when multiple apps or packages would use them. Web must not import `@sokosumi/database` (including `/helpers`)—see [utils vs database helpers](.cursor/rules/utils-vs-database.mdc).

### Database Access

> [!IMPORTANT]
> **Direct database access from `apps/web` is forbidden.** All database reads and writes MUST be implemented in `apps/core` and exposed as Core API endpoints. The web app consumes data exclusively through the generated Core API client — never through Prisma, Postgres, or `@sokosumi/database` repositories.

- **Forbidden in `apps/web`**: importing `@sokosumi/database` repositories/helpers, instantiating or calling the Prisma client, or issuing raw SQL. Web services (`src/lib/services/`) and actions (`src/lib/actions/`) coordinate domain flows but obtain their data by calling Core endpoints.
- **Required in `apps/core`**: every new data-access need is implemented as a versioned route under `apps/core/src/routes/v1/`, using direct Prisma (legacy services may still use `@sokosumi/database/repositories`), validated with the Core Zod/OpenAPI schemas (`apps/core/src/schemas/`).
- **Web → Core wiring**: after adding/changing a Core endpoint, regenerate the Core API client (`pnpm --filter web generate:core:snapshot`), then run `pnpm --filter web typecheck` (or `pnpm web:typecheck`) to catch DTO drift. Do not chain typecheck into the generate script. Call regenerated endpoints from the web service layer. Do not hand-edit the generated client—see [Generated Files](#generated-files).
- **Web DTO boundary**: do not import `@sokosumi/database` or domain enum **values** from `@sokosumi/utils` in web — use the generated Core client. Details and approved utils exceptions live in `apps/web/AGENTS.md` (Core DTO boundary).
- **Why**: a single owner for data access keeps authorization, validation, and schema invariants in one place, lets the web app stay a thin client, and removes Prisma/Postgres credentials from the web runtime.

### Code References

- Use backticks for file, directory, function, and class names
- Reference existing code rather than duplicating it
- Use `@/lib/*` aliases for imports

## Agent skills

### Linear issue implementation

Ship one Linear issue with `## Requirement` under **/poteto-mode** via [`.cursor/skills/sokosumi-linear-issue/`](.cursor/skills/sokosumi-linear-issue/). That skill owns Spec, allowlisted verify, TDD globs, draft PR, CI gate, pinned-`headSha` re-verify, Review `/goal`, and opt-in swarm-verify (user ask, `swarm-verify: true`, or label `swarm-verify`). Human merges. Bugs/refactors without a Linear Requirement use other poteto playbooks.

Do **not** invent or file Linear issues during poteto implement work. Filing a new requirement is a separate, explicit ask via [`.cursor/skills/linear-requirement/`](.cursor/skills/linear-requirement/) (`disable-model-invocation`).

### Issue tracker

Issues live in Linear (team "Sokosumi", key `SOK`), accessed via the Linear MCP tools. See [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

### Triage labels

Hybrid mapping: native Linear statuses for needs-triage (Triage) and wontfix (Canceled); labels `needs-info` / `ready-for-agent` / `ready-for-human`. See [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See [`docs/agents/domain.md`](./docs/agents/domain.md).

**Cloud agent database:** [`docs/agents/cloud-agent-database.md`](./docs/agents/cloud-agent-database.md) — ephemeral Neon branch per agent run via `DATABASE_URL`, provision/teardown, 72h idle TTL.

**Coworker integrators:** [`docs/coworker/vendor-workspace-grants-api.md`](./docs/coworker/vendor-workspace-grants-api.md) — vendor workspace grants, `GRANT_PENDING`, Core API error kinds.

**Orchestrator (Hermes):** [`docs/orchestrator/hermes-orchestrator-actor.md`](./docs/orchestrator/hermes-orchestrator-actor.md) — first-party orchestrator actor (`ORCHESTRATOR_SERVICE_TOKEN`), DRAFT access, DRAFT↔READY status, usage/purge.

## Additional Rules

- [Principles](.cursor/rules/principles.mdc) – architecture judgment: delete over shims, simplest keepable design, layered growth
- [Maintainability](.cursor/rules/maintainability.mdc) – long-term clarity and consistency over short-term wins
- [Pinned dependencies](.cursor/rules/pinned-dependencies.mdc) – exact versions in `package.json`, no semver ranges on registry packages
- [Result Type with neverthrow](.cursor/rules/neverthrow.mdc)
- [Shared packages and deduplication](.cursor/rules/shared-packages.mdc) – when moving logic to `packages/utils` or refactoring duplicated code
- [Avoid re-exports](.cursor/rules/avoid-re-exports.mdc) – import from the canonical owner; no passthrough barrels between packages or apps
- [Utils vs database helpers](.cursor/rules/utils-vs-database.mdc) – client-safe shared code in `@sokosumi/utils`; Prisma-backed logic in `@sokosumi/database`

## References

- [Cursor Agents Documentation](https://cursor.com/docs/context/rules#agentsmd)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Shadcn UI](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)

## Cursor Cloud specific instructions

These notes cover non-obvious, durable facts about running this repo in the Cursor Cloud VM. The update script runs `pnpm install` then provisions an ephemeral Neon agent database when secrets are present (see below). Node, tooling, and non-DB `.env` values may still come from the VM snapshot.

### Runtime versions

- **Node 24 is the required runtime** (`engines: 24.x`, root `.nvmrc` = `lts/krypton`). The base image's `/exec-daemon/node` is Node 22 and is early in `PATH`, so Node 24 (installed via nvm) is symlinked into `/usr/local/cargo/bin` (which is first in `PATH`) as `node`/`npm`/`npx`/`corepack`/`pnpm`. This makes `node -v` = 24 and `pnpm -v` = 11.18.0 in **every** shell (login or not). If a future run somehow sees Node 22, recreate those symlinks from `~/.nvm/versions/node/v24*/bin`.

### Database (Cloud agent Neon branch)

Cloud agents get a **disposable Neon branch** forked from production/`main`, not a shared mutable DB and not live production writes.

- **Provision:** `.cursor/environment.json` `install` runs `node scripts/cloud-agent-db/provision.mjs` after `pnpm install` when `CURSOR_AGENT=1` and `NEON_API_KEY` + `NEON_PROJECT_ID` are set (Cursor Runtime Secrets). Branch name: `cloud-agent-<CURSOR_CONVERSATION_ID>`. Parent is always `NEON_PARENT_BRANCH` (default `main`). Resume reuses the same branch and refreshes the **72h** `expires_at` TTL. Pending migrations run via `pnpm prisma:migrate:deploy` (`DATABASE_URL_UNPOOLED`). After migrate, upserts guarded auth fixtures (`admin@sokosumi.test` / `alice@sokosumi.test` / `Password123!`) on agent branches only — **not** a full catalog seed.
- **Use:** Prefer `node scripts/cloud-agent-db/with-db.mjs -- <command>` so ambient/stale `DATABASE_URL` cannot win. `start` already wraps `pnpm dev`. Login shells source `.cursor/cloud-agent-db.env` via bashrc/profile.
- **Teardown:** deletes only `cloud-agent-*` branches — never production/`main`. Triggers: PR merged/closed (GitHub Action parses `bc-…` from PR body), agent completes with no PR (`pnpm cloud-agent-db:teardown`), agent archived (same when possible). Idle **72h** expiry is Neon `expires_at` only (no scheduled Action GC).
- **Do not** put a static production `DATABASE_URL` in Cursor secrets. Full runbook: [`docs/agents/cloud-agent-database.md`](./docs/agents/cloud-agent-database.md).

### Database (local PostgreSQL fallback)

When Neon secrets are absent, provision skips and local Postgres remains the fallback (snapshot-oriented).

- Local cluster is **PostgreSQL 16** (apt). It is **not started on boot** — start it with `sudo pg_ctlcluster 16 main start` (check with `pg_lsclusters`). DB `core`, role `sokosumi` / password `sokosumi`, on `localhost:5432`.
- **Gotcha — ambient `DATABASE_URL`:** if the platform still injects a stale Neon URL (`...neon.tech...`, auth fails), `dotenv` does **not** override it. Prefer `with-db.mjs` when a provisioned agent branch exists; otherwise use a login shell (provision injects bashrc) or prefix commands with the local URL. If you see `Authentication failed against the database server` or an unexpected `neon.tech` host without a provisioned agent branch, unset/override `DATABASE_URL`.
- Schema is already applied on the snapshot DB. After pulling schema changes without a Neon agent branch, run `pnpm prisma:generate` then `pnpm prisma:migrate:deploy`. To inspect local: `PGPASSWORD=sokosumi psql -h localhost -U sokosumi -d core`.

### `.env` files (gitignored, snapshot-persisted)

`apps/core/.env` and `apps/web/.env` were created from `.env.example` with local fixes so the apps boot past their Zod env validation. Non-obvious edits: DB host `sokosumi`→`localhost` (overwritten by agent DB provision when Neon secrets are present); `POSTMARK_FROM_EMAIL` and `HERMES_ORCH_BASE_URL` set to valid dummy values; invalid placeholders removed (`COMPOSIO_API_KEY`, `AGENT_HIRED_WEBHOOK`); `BETTER_AUTH_COOKIE_DOMAIN` disabled so session cookies work on `localhost`; web `APP_SIGNING_SECRET` set equal to Core `BETTER_AUTH_SECRET` (required to match).

### Running & known local gotchas

- Start services: `pnpm core:dev` / `pnpm web:dev` / `pnpm dev`, or `node scripts/cloud-agent-db/with-db.mjs -- pnpm dev` when an agent Neon branch is provisioned. Core API on `:8787` (Swagger at `/`, OpenAPI at `/v1/openapi.json`); web on `:3000`.
- **Auth for a test account:** on a provisioned agent Neon branch, use fixtures `admin@sokosumi.test` (platform admin), `alice@sokosumi.test`, or `bob@sokosumi.test` with password `Password123!` (upserted after migrate; agent branches only). Each fixture also owns one org (`admin-fixture` / `alice-fixture` / `bob-fixture`) with an organization workspace. Otherwise email/password signup works with no email verification and auto sign-in (`/signup`). Google/Microsoft OAuth and magic-link email do **not** work (placeholder credentials).
- **Agents catalog:** on a Neon agent branch forked from production, catalog/billing data comes from the parent. On empty local Postgres, `GET /v1/agents` / `/v1/categories` may 500 until `credit_cost` has rows (admin `POST /v1/credit-costs` / `/admin` UI) — missing data, not a broken build.
- **Realtime (Ably) is unconfigured:** `POST /api/ably/auth` returns 500 (`No key specified`) and chat pages surface a "Something went wrong" modal, because `ABLY_SUBSCRIBE_ONLY_KEY` / Core `ABLY_PUBLISH_ONLY_KEY` are placeholders. Optional; unrelated to setup.
- Lint (`pnpm lint`), tests (`pnpm test`), and type checks do **not** need the DB or the servers running.

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
