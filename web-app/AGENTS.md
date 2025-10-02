# Repository Guidelines

## Project Structure & Module Organization

The pnpm workspace hosts the Next.js client in `web-app/`. App Router routes, server actions, and API handlers sit under `src/app`, while shared UI primitives live in `src/components`, hooks in `src/hooks`, and contexts in `src/contexts`. Domain adapters and business logic belong to `src/lib` with feature tests alongside them in `__tests__/`. Place static files in `public/`, Prisma schema and migrations in `prisma/`, translation catalogs in `messages/`, and reusable test doubles in `__mocks__/`.

## Build, Test, and Development Commands

Run `pnpm install` at the repo root to hydrate dependencies. Use `pnpm sokosumi-web:dev` for the web app dev server and `pnpm dev` when you need every workspace watcher. Ship builds with `pnpm build`, then smoke test using `pnpm sokosumi-web:start`. Lint via `pnpm lint` or the CI-friendly `pnpm sokosumi-web:lint:report`. Execute tests with `pnpm test`; CI mirrors `pnpm sokosumi-web:test:ci`.

## Coding Style & Naming Conventions

TypeScript is mandatory. Pairs of spaces and semicolons are enforced by the shared Prettier profile—run `pnpm sokosumi-web:format` after substantial edits. React components and exported types use PascalCase, helpers stay camelCase, constants are SCREAMING_SNAKE_CASE, and Prisma models remain singular. Keep imports relative within a feature; otherwise use the defined workspace aliases.

## Testing Guidelines

Jest with happy-dom powers unit and integration suites. Name test files `*.test.ts(x)` and colocate them under the nearest `__tests__/` directory. When touching `src/lib`, cover both success and failure paths, mocking external services through `__mocks__` or Prisma factories. Refresh snapshots and run `pnpm test` before submitting changes.

## Commit & Pull Request Guidelines

Commits follow Conventional Commit syntax, e.g., `feat(auth): add refresh token (#1234)`. PRs must explain user-facing impact, link Linear or GitHub issues, list verification steps such as `pnpm test`, and attach screenshots for UI changes. Flag schema updates with migration filenames and call out follow-up work so reviewers can plan coverage.
