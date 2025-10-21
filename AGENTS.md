# Sokosumi Agent Guidelines

> **Purpose**: This document provides comprehensive guidelines for AI agents working on the Sokosumi monorepo. For app-specific details, see [`web-app/AGENTS.md`](./web-app/AGENTS.md).

## Tech Stack & Architecture

**Core Stack**: Next.js 15 (App Router), React 19, TypeScript, pnpm workspace
**Architecture**: Three-layer pattern with repositories (`src/lib/db/repositories/`) wrapping Prisma/Postgres, services (`src/lib/services/`) coordinating domain flows, and actions (`src/lib/actions/`) exposing typed server mutations
**Styling**: Tailwind CSS + shadcn/ui + Radix UI primitives
**Auth**: Better Auth with organization-aware sessions
**i18n**: next-intl for internationalization

## Project Layout

```
sokosumi/
├── web-app/                    # Next.js application
│   ├── src/app/               # App Router routes, server actions, API handlers
│   ├── src/components/        # Shared UI components
│   ├── src/hooks/            # Custom React hooks
│   ├── src/contexts/         # React contexts
│   ├── src/lib/              # Domain logic (repositories, services, actions)
│   │   ├── db/repositories/  # Prisma/Postgres access layer
│   │   ├── services/         # Business logic coordination
│   │   └── actions/          # Server mutations
│   ├── __tests__/            # Colocated tests
│   ├── __mocks__/            # Reusable test doubles
│   ├── public/               # Static assets
│   ├── prisma/               # Database schema and migrations
│   └── messages/             # Translation catalogs
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
- **Formatting**: Run `pnpm sokosumi-web:format` after substantial edits
- **Imports**: Relative within features, use aliases (`@/lib/*`) otherwise
- **Components**: Default to Server Components; add `'use client'` only for browser APIs

## Environment & Tooling

### Prerequisites

- Node.js 22+
- pnpm package manager

### Setup

1. Run `pnpm install` at repo root
2. Copy `web-app/.env.example` to `web-app/.env`
3. Bootstrap database: `pnpm prisma:migrate:dev`
4. Generate Prisma clients: `pnpm prisma:generate`
5. Generate API clients: `pnpm generate:api` (when specs change)

## Commands

| Command                         | Purpose                      |
| ------------------------------- | ---------------------------- |
| `pnpm install`                  | Install dependencies         |
| `pnpm dev`                      | Watch all workspace packages |
| `pnpm sokosumi-web:dev`         | Run web app dev server       |
| `pnpm build`                    | Build for production         |
| `pnpm sokosumi-web:start`       | Smoke test production build  |
| `pnpm lint`                     | Lint codebase                |
| `pnpm sokosumi-web:lint:report` | CI-friendly lint report      |
| `pnpm test`                     | Run tests locally            |
| `pnpm sokosumi-web:test:ci`     | CI test execution            |
| `pnpm sokosumi-web:format`      | Format code with Prettier    |

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

### Code References

- Use backticks for file, directory, function, and class names
- Reference existing code rather than duplicating it
- Use `@/lib/*` aliases for imports

## References

- [Cursor Agents Documentation](https://cursor.com/docs/context/rules#agentsmd)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Shadcn UI](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
