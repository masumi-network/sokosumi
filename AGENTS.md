# Repository Guidelines

## Project Structure & Module Organization
Sokosumi is a pnpm workspace; focus on the Next.js app in `web-app/`. Application code lives in `web-app/src`, with routes under `src/app`, shared UI in `src/components`, and domain logic in `src/lib`. Static assets stay in `web-app/public`. Prisma schema and migration scripts reside in `web-app/prisma`, and generated API clients land in `src/lib/clients/generated`. Jest tests sit alongside features in `__tests__` folders, for example `src/lib/job-input/__tests__/job-input.test.ts`.

## Build, Test, and Development Commands
Run `pnpm install` at the repo root to hydrate the workspace. Inside `web-app/`:
- `pnpm dev`: launch the Next.js dev server on `http://localhost:3000`.
- `pnpm build`: produce a production build and type-check the project.
- `pnpm start`: serve the compiled build locally.
- `pnpm lint`: run ESLint with zero warning tolerance.
- `pnpm format`: apply Prettier (Tailwind plugin included) to source files.
- `pnpm test:ci`: execute the Jest test suite in CI-friendly mode.
Prisma helpers include `pnpm prisma:generate` (regen client) and `pnpm prisma:migrate:dev` (apply local schema changes).

## Coding Style & Naming Conventions
Code is TypeScript-first with React Server Components. Prettier enforces two-space indentation, double quotes, trailing commas, and Tailwind class sorting. Keep React components and files in PascalCase (`JobSearchPanel.tsx`); hooks stay camelCase (`useJobFilters.ts`). Imports are auto-sorted via `simple-import-sort`; favor absolute paths from `src/`. The ESLint rule `no-relative-import-paths` blocks traversing up directories. Avoid direct `process.env` access—use `getEnvSecrets` or `getEnvConfig` helpers instead.

## Testing Guidelines
Write Jest tests under feature-level `__tests__` directories with filenames ending in `.test.ts`. Use Testing Library patterns for component behavior and mock network calls with existing fixtures. Ensure new Prisma migrations ship with matching `data-migration` scripts when data changes. Always run `pnpm test:ci` and `pnpm lint` before opening a PR.

## Commit & Pull Request Guidelines
Follow Conventional Commit semantics (`feat(auth): add passkey login`). Keep branches off `main`, push early, and open draft PRs for feedback. PR descriptions should summarize changes, link issues, and add screenshots or Looms for UI updates. Verify that linting, tests, and required Prisma commands succeed locally before requesting review.
