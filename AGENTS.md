# Sokosumi Agent Guidelines

> **Purpose**: This document provides comprehensive guidelines for AI agents working on the Sokosumi monorepo. For app-specific details, see [`apps/web/AGENTS.md`](./apps/web/AGENTS.md), [`apps/core/AGENTS.md`](./apps/core/AGENTS.md), [`packages/database/AGENTS.md`](./packages/database/AGENTS.md), and [`packages/masumi/AGENTS.md`](./packages/masumi/AGENTS.md).

## Tech Stack & Architecture

**Core Stack**: Next.js 16 (App Router), React 19.2, TypeScript, pnpm workspace, Node.js 24.x
**Web Architecture**: Three-layer pattern with repositories (`@sokosumi/database`) wrapping Prisma/Postgres, services (`src/lib/services/`) coordinating domain flows, and actions (`src/lib/actions/`) exposing typed server mutations
**API Architecture**: Hono with OpenAPI validation and standardized response helpers
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
│   └── masumi/                # Masumi protocol utilities (@sokosumi/masumi)
│       ├── src/clients/       # Agent API client
│       ├── src/hash/          # Hash utilities for job verification
│       ├── src/schemas/       # Agent protocol Zod schemas
│       └── src/types/         # Agent types
├── docs/                      # Documentation (future)
├── eslint.config.mjs          # Root ESLint configuration
└── prettier.config.mjs        # Root Prettier configuration
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

- **Indentation**: Two spaces, semicolons enforced by Prettier
- **Formatting**: Run `pnpm web:format` after substantial edits
- **Imports**: Relative within features, use aliases (`@/lib/*`) otherwise
- **Components**: Default to Server Components; add `'use client'` only for browser APIs

### Linting & Formatting

#### ESLint Configuration

The monorepo uses a comprehensive ESLint setup with the following enforced rules:

**Import Organization**:

- Auto-sorted imports via `simple-import-sort` plugin (run `pnpm web:format` to fix)
- No unused imports (`unused-imports/no-unused-imports`)
- Import statements must appear first with newline after
- No duplicate imports from same module

**TypeScript Rules**:

- Unused variables/arguments trigger warnings (not errors)
- Prefix unused identifiers with underscore to suppress: `const _unused = value;`
- Applies to: variables, function arguments, caught errors, destructured arrays

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

#### Prettier Configuration

All code must follow these formatting rules:

- **Indentation**: 2 spaces (never tabs)
- **Semicolons**: Required
- **Quotes**: Double quotes (not single)
- **Trailing Commas**: Required in multi-line structures
- **Auto-fix**: Run `pnpm web:format`

**Example**:

```typescript
const config = {
  name: "example",
  items: [1, 2, 3],
};
```

#### Common Linter Fixes

| Error                               | Solution                         |
| ----------------------------------- | -------------------------------- |
| `simple-import-sort/imports`        | Run `pnpm web:format`            |
| `unused-imports/no-unused-imports`  | Remove import or use it          |
| `@typescript-eslint/no-unused-vars` | Use variable or prefix with `_`  |
| `import/no-duplicates`              | Combine imports from same module |

## Environment & Tooling

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
| `pnpm lint`            | Lint entire codebase          |
| `pnpm web:lint`        | Lint web app                  |
| `pnpm web:lint:report` | CI-friendly lint report       |
| `pnpm test`            | Run tests locally             |
| `pnpm web:test`        | Run web app tests             |
| `pnpm masumi:test`     | Run masumi package tests      |
| `pnpm web:test:ci`     | CI test execution             |
| `pnpm web:format`      | Format web app code           |
| `pnpm database:format` | Format database package code  |

## Testing Guidelines

- **Framework**: Jest with jsdom and Testing Library
- **Test Files**: Name as `*.test.ts(x)` and colocate under nearest `__tests__/`
- **Coverage**: Cover both success and failure paths when touching `src/lib`
- **Mocking**: Use `__mocks__` or Prisma factories for external services
- **Execution**: No watch mode—run `pnpm test` and refresh snapshots before pushing

## Commit & Pull Request Guidelines

### Commits

Follow [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) syntax:

```
feat(auth): add refresh token (#1234)
fix(ui): resolve button alignment issue
docs(readme): update setup instructions
```

### Pull Requests

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

### Code References

- Use backticks for file, directory, function, and class names
- Reference existing code rather than duplicating it
- Use `@/lib/*` aliases for imports

## Additional Rules

- [Linting](.cursor/rules/lint.mdc)
- [Result Type with neverthrow](.cursor/rules/neverthrow.mdc)

## References

- [Cursor Agents Documentation](https://cursor.com/docs/context/rules#agentsmd)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Shadcn UI](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
