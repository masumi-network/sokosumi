# Repository Guidelines

## Project Structure & Module Organization

Sokosumi is a pnpm workspace with the Next.js app in `web-app/`. App Router routes, server actions, and API handlers live in `src/app`; shared UI in `src/components`, hooks in `src/hooks`, and contexts in `src/contexts`. Domain adapters, repositories, services, and actions belong under `src/lib/**` with domain tests in sibling `__tests__/`. Static assets go to `public/`, Prisma schema and migrations to `prisma/`, translations to `messages/`, and reusable mocks to `__mocks__/`.

## Architecture Snapshot

Next.js 15 App Router with strict TypeScript underpins the app. The core library follows a three-layer pattern: repositories (`src/lib/db/repositories/`) wrap Prisma/Postgres access, services (`src/lib/services/`) coordinate domain flows and external API clients, and actions (`src/lib/actions/`) expose typed server mutations. Tailwind plus shadcn/ui drive styling, `next-intl` covers i18n, and Better Auth provides organization-aware sessions.

## Environment & Tooling

Install Node 22+ and pnpm. Run `pnpm install`, copy `web-app/.env.example` to `web-app/.env`, then bootstrap the database with `pnpm prisma:migrate:dev`. Regenerate Prisma clients via `pnpm prisma:generate` and refresh external API clients when specs change using `pnpm generate:api`.

## Build, Test, and Development Commands

`pnpm sokosumi-web:dev` runs the web app dev server; `pnpm dev` watches every workspace package. Build for production with `pnpm build` and smoke test using `pnpm sokosumi-web:start`. Lint through `pnpm lint` or the CI-friendly `pnpm sokosumi-web:lint:report`. Execute tests locally with `pnpm test`; CI mirrors `pnpm sokosumi-web:test:ci`.

## Coding Style & Naming Conventions

TypeScript everywhere, semicolons and two-space indentation enforced by the shared Prettier profile—run `pnpm sokosumi-web:format` after sizable edits. React components and exported types are PascalCase, helpers stay camelCase, constants are SCREAMING_SNAKE_CASE, and Prisma models remain singular. Default to Server Components; add `'use client'` only for browser APIs. Keep imports relative within a feature or use configured aliases such as `@/lib/*`.

## Testing Guidelines

Jest with happy-dom and Testing Library power unit and integration suites. Name test files `*.test.ts(x)` and colocate them under the nearest `__tests__/`. When touching `src/lib`, cover both success and failure paths, mocking externals through `__mocks__` or Prisma factories. No watch mode—run `pnpm test` and refresh snapshots before pushing.

## Commit & Pull Request Guidelines

Commits follow Conventional Commit syntax, e.g., `feat(auth): add refresh token (#1234)`. PRs explain user-facing impact, link Linear or GitHub issues, list verification steps (e.g., `pnpm test`, `pnpm build`), and attach screenshots for UI updates. Flag schema changes with migration filenames and mention any related data scripts (`pnpm data-migration:<name>`) so reviewers can plan verification.
