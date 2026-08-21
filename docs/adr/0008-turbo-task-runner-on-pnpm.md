# ADR 0008: Turborepo as task runner on the pnpm workspace

- Status: Accepted
- Date: 2026-08-20

pnpm stays the package manager. Turborepo runs `build`, `typecheck`, and `test` so the task graph is declared once (`dependsOn: ["^build"]` plus uncached `prisma:generate`) instead of in `database:build &&` and Core/web fan-out scripts.

Vercel filtered installs still emit package `dist` via per-package `prepare`. App-level `prebuild` / `build:workspace-deps` are removed so turbo is the only orchestrator on the root `build`/`typecheck`/`test` path.

CI uses Vercel Remote Cache via GitHub OIDC (`vercel/setup-turborepo-remote-cache-action`). `turbo.json` lists hashed `globalEnv` and unhashed `globalPassThroughEnv`; default strict `envMode` (do not set `envMode: "loose"`). Do not add GitHub `actions/cache` on `.turbo`. `dev`, Biome, Husky, and `pnpm --filter` aliases stay.

## Considered Options

- Keep `pnpm -r` and the hand-coded DAGs — no new tool, graph stays in scripts.
- Nx or full turbo (`--affected` CI, Vercel `turbo run build`) — bigger than the pain.
- Add turbo on pnpm for `build` / `typecheck` / `test` only — chosen.
