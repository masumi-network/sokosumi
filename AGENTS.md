# Sokosumi Agent Guidelines

> **Purpose**: This document provides comprehensive guidelines for AI agents working on the **Sokosumi monorepo** (apps, shared packages, tooling). It is not app-specific. For scoped guidance, see [`apps/web/AGENTS.md`](./apps/web/AGENTS.md), [`apps/core/AGENTS.md`](./apps/core/AGENTS.md), [`packages/database/AGENTS.md`](./packages/database/AGENTS.md), [`packages/masumi/AGENTS.md`](./packages/masumi/AGENTS.md), and [`packages/email/AGENTS.md`](./packages/email/AGENTS.md).

## Tech Stack & Architecture

**Core Stack**: Next.js 16 (App Router), React 19.2, TypeScript, pnpm workspace, Node.js 24.x  
**Web Architecture**: Three-layer pattern with services (`src/lib/services/`) coordinating domain flows and actions (`src/lib/actions/`) exposing typed server mutations. Web reaches data **only through the Core API** — it never touches Prisma/Postgres directly (see [Database Access](#database-access)).
**API Architecture**: Hono with OpenAPI validation and standardized response helpers. Core owns all database access via repositories (`@sokosumi/database`) wrapping Prisma/Postgres.
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
│   ├── email/                 # Shared email renderers and locales (@sokosumi/email)
│   ├── chat/                  # Chat types and shared chat utilities (@sokosumi/chat)
│   └── ai-provider/           # Sokosumi AI SDK provider (@sokosumi/ai-provider)
├── docs/                      # Documentation (future)
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

- **Framework**: Vitest with Testing Library and workspace-specific environments (for example `happy-dom` in `apps/web` and Node in packages/services)
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
- **`packages/utils`** holds framework-agnostic helpers (URL/file utilities, markdown link extraction, user-name helpers, client-safe billing types/parsers). Add new shared helpers here when multiple apps or packages would use them. Do not import `@sokosumi/database/helpers` from client components—see [utils vs database helpers](.cursor/rules/utils-vs-database.mdc).

### Database Access

> [!IMPORTANT]
> **Direct database access from `apps/web` is forbidden.** All database reads and writes MUST be implemented in `apps/core` and exposed as Core API endpoints. The web app consumes data exclusively through the generated Core API client — never through Prisma, Postgres, or `@sokosumi/database` repositories.

- **Forbidden in `apps/web`**: importing `@sokosumi/database` repositories/helpers, instantiating or calling the Prisma client, or issuing raw SQL. Web services (`src/lib/services/`) and actions (`src/lib/actions/`) coordinate domain flows but obtain their data by calling Core endpoints.
- **Required in `apps/core`**: every new data-access need is implemented as a versioned route under `apps/core/src/routes/v1/`, backed by `@sokosumi/database` repositories, validated with the Core Zod/OpenAPI schemas (`apps/core/src/schemas/`).
- **Web → Core wiring**: after adding/changing a Core endpoint, regenerate the Core API client (`pnpm --filter web generate:core:snapshot`) and call it from the web service layer. Do not hand-edit the generated client—see [Generated Files](#generated-files).
- **Why**: a single owner for data access keeps authorization, validation, and schema invariants in one place, lets the web app stay a thin client, and removes Prisma/Postgres credentials from the web runtime.

### Code References

- Use backticks for file, directory, function, and class names
- Reference existing code rather than duplicating it
- Use `@/lib/*` aliases for imports

## Agent skills

### Issue tracker

Issues live in Linear (team "Sokosumi", key `SOK`), accessed via the Linear MCP tools. See [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

### Triage labels

Hybrid mapping: native Linear statuses for needs-triage (Triage) and wontfix (Canceled); labels `needs-info` / `ready-for-agent` / `ready-for-human`. See [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See [`docs/agents/domain.md`](./docs/agents/domain.md).

## Additional Rules

- [Linting](.cursor/rules/lint.mdc)
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
