# Repository Guidelines

## Project Structure & Module Organization
Sokosumi is a pnpm workspace; most development happens in `web-app/`. Routes live under `web-app/src/app`, shared UI in `src/components`, domain services in `src/lib`, and Prisma schema plus migrations in `web-app/prisma`. Generated API clients target `src/lib/clients/generated`, shadcn primitives live in `src/components/ui`, and messaging assets sit in `web-app/messages`. Tests stay beside features in `__tests__` directories such as `src/lib/job-input/__tests__/job-input.test.ts`.

## Build, Test, and Development Commands
Run `pnpm install` at the repo root. Within `web-app/`:
- `pnpm dev`: start the Next.js dev server on `http://localhost:3000`.
- `pnpm build`: create a production bundle and regenerate Prisma artifacts.
- `pnpm start`: serve the compiled bundle locally.
- `pnpm lint`: enforce ESLint rules with zero warning tolerance.
- `pnpm format`: apply Prettier (Tailwind plugin included).
- `pnpm test:ci`: run the Jest suite in CI mode.
Prisma utilities include `pnpm prisma:generate`, `pnpm prisma:migrate:dev`, `pnpm prisma:migrate:deploy`, and `pnpm prisma:seed`. Run `pnpm generate:api` after touching OpenAPI contracts.

## Coding Style & Naming Conventions
TypeScript is mandatory; prefer interfaces over types and avoid enums in favor of objects or unions. Files and directories use kebab-case, while React components adopt PascalCase filenames with named exports. Favor server components and add `'use client'` only when browser APIs require it. Event handlers follow the `handleX` pattern, helpers use the `function` keyword, and state flags read `isLoading` or `hasError`. Imports auto-sort via `simple-import-sort`; cross-folder imports use aliases like `@/components`, `@/lib`, `@/services`, `@/types`, and `@/messages`. Access environment values through `getEnvSecrets` or `getEnvConfig`, and lean on `nuqs` for URL search parameter state.

## Testing Guidelines
Write Jest + Testing Library specs in feature-level `__tests__` folders with `.test.ts` suffixes. Mock external services with existing fixtures. Pair schema changes with matching `data-migration` scripts, then run `pnpm test:ci`, `pnpm lint`, and relevant Prisma commands before opening a PR.

## Commit & Pull Request Guidelines
Commits and PR titles follow Conventional Commit syntax (`feat(auth): add passkey login`). Branch from `main`, push early, and open draft PRs for discussion. Include change summaries, linked issues, and UI screenshots or Looms when applicable. Confirm linting, tests, migrations, and API client generation succeed locally before marking a PR ready for review.
