# Sokosumi Monorepo

Sokosumi is a marketplace platform. This monorepo is the web app, the Core API, native Apple apps, the developer CLI, and shared packages.

## Project Structure

```
sokosumi/
├── apps/
│   ├── web/         # Next.js 16 web app (TypeScript, Tailwind, Shadcn UI)
│   ├── core/        # Hono API — owns all Postgres/Prisma access
│   ├── apple/       # Native macOS + iOS — Xcode (outside turbo and Biome)
│   └── cli/         # Developer CLI — Ink TUI and headless commands (SPEC + VISION)
├── packages/
│   ├── database/    # @sokosumi/database — Prisma schema, client, helpers
│   ├── masumi/      # @sokosumi/masumi — protocol clients, hash, schemas
│   ├── utils/       # @sokosumi/utils — client-safe helpers
│   ├── net/         # @sokosumi/net — SSRF-safe fetch
│   ├── email/       # @sokosumi/email — renderers and locales
│   ├── ai-provider/ # @sokosumi/ai-provider — Sokosumi AI SDK provider
│   └── soko-bot/    # @sokosumi/soko-bot — Soko Bot contracts (loop runs in per-bot Vercel Sandboxes; Core is the control plane)
├── docs/            # Agent, domain, coworker, and design docs
├── scripts/         # local-env, cloud-agent-db, CI helpers
├── skills/          # First-party agent skill sources
├── biome.jsonc      # Root Biome configuration
├── turbo.json       # Turborepo task graph
├── package.json     # Monorepo root config
└── pnpm-workspace.yaml
```

- **apps/web/**: User-facing web application (Next.js 16, React 19.3, Tailwind CSS, Shadcn UI, next-intl). Reaches data only through the Core API — it does not use Prisma.
- **apps/core/**: Hono API on Node.js. All database reads and writes live here.
- **apps/cmo/**: CMO at cmo.xyz (Next.js 16). A separate product that signs in with Sokosumi through Core's OAuth provider; it has no database.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x
- [pnpm](https://pnpm.io/) 12 (monorepo package manager; pin is `packageManager` in the root `package.json`)

### Clone and Install

```bash
git clone https://github.com/masumi-network/sokosumi.git
cd sokosumi
pnpm install
```

### Setup Environment

```bash
pnpm env:bootstrap
```

Copies `apps/web/.env.example` and `apps/core/.env.example` to `.env` when missing, replaces Zod-breaking placeholders, and comments production `BETTER_AUTH_COOKIE_DOMAIN` in `.env` (portless injects `sokosumi.localhost` at runtime). Grok copies (`.git/grok-worktree-source`) and linked git worktrees reuse the primary checkout `.env` so `BETTER_AUTH_SECRET` / `DATABASE_URL` match — unless the worktree already has a unique secret.

One-time on a machine, start the portless HTTPS proxy (port 443, may prompt for sudo) and trust the local CA if `portless doctor` says it is untrusted:

```bash
pnpm exec portless trust    # once, if CA is not trusted
pnpm portless:proxy         # HTTPS on 443
```

## Development

Named local URLs (worktree-safe). Linked worktrees get a branch prefix (`https://<branch>.web.sokosumi.localhost`):

```bash
pnpm portless:dev     # web + core
pnpm portless:web     # web only (still prints and injects both named URLs)
pnpm portless:core    # core only
pnpm portless:cmo     # CMO only
```

- Web: `https://web.sokosumi.localhost` (`pnpm portless:url web`)
- Core: `https://core.sokosumi.localhost` (`pnpm portless:url core`) — OpenAPI at `/v1/openapi.json`
- CMO: `https://cmo.sokosumi.localhost` (`pnpm portless:url cmo`)

Grok/Cursor copies under `.grok/worktrees/` are not git worktrees, so portless cannot prefix the branch. `pnpm portless:dev` prefixes the directory basename (`https://3877.web.sokosumi.localhost`) and uses `--force` so a leftover process cannot keep Core from starting. Restarting kills the previous process for that name. Linked `git worktree add` checkouts (including `.worktrees/`) keep Portless's branch prefix only — do not stack a second basename. Always print URLs with `pnpm portless:url web` / `core` (bare `portless get web.sokosumi` skips the Grok basename).

Single-app commands still wire `WEB_APP_BASE_URL` / `BETTER_AUTH_URL` / `CORE_APP_BASE_URL` from those named URLs. Start the other named host separately; classic `:3000` / `:8787` is not in play.

Classic single-checkout ports still work:

```bash
pnpm web:dev    # http://localhost:3000
pnpm core:dev   # http://localhost:8787
```

Agents should use `verify-sokosumi launch` (see [AGENTS.md](./AGENTS.md)) so `.env`, the 443 proxy, and named URLs stay in sync.

Other available scripts:

- `pnpm build` — TypeScript build
- `pnpm check` — Biome check; CI and the husky hook run this
- `pnpm format` — Write Biome formatting (not the gate)

## Testing

- The monorepo uses Vitest for unit tests.
- Name tests `*.test.ts(x)` and place them next to the source they cover (`foo.test.ts` beside `foo.ts`). Use `__tests__/` only when a test does not map 1:1 to a single source file.
- Run all workspace tests from the repo root with `pnpm test`.
- Run a single workspace with `pnpm --filter web test`, `pnpm --filter core test`, or `pnpm --filter @sokosumi/<package> test`.

## Deployment

- **Production:** A push to `main` production-deploys web and core on both mainnet and preprod through Vercel Git (`git.deploymentEnabled` allows `main` only). There is no GitHub Actions or GitHub Release production path.
- **Preview:** Only a comment from someone with repository write access on an open, same-repository PR can deploy. `/deploy` shows help; `/deploy mainnet`, `/deploy preprod`, and `/deploy all` select networks. Mainnet also deploys CMO, which has no preprod project. Opening, updating, or reopening a PR creates nothing. Commands must start the first line. Docs-only changes are skipped.
- **Preview database:** Actions creates or reuses `preview/gh-<repo-id>-pr-<number>` in each selected network's Neon project, branching from its default production branch. It writes pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` as encrypted, Git-branch-scoped Preview variables on Core only. Both build and runtime receive them. Redeployment preserves preview data and renews its 24-hour expiry. Each new commit to the PR also renews existing preview databases for 24 hours, without deploying or creating databases. Expiry deletes preview-only data; `/deploy <network>` recreates an expired database from its parent.
- **Cleanup:** Closing or merging the PR deletes its tagged Vercel deployments, owned Core environment variables, and managed Neon branches. Daily reconciliation at 03:17 UTC (also available through **Run workflow**) retries missed closes. Deploy, reset, commit renewal, and cleanup share a per-PR queue and recheck PR state. Protected/default databases, production deployments, legacy `preview/<git-branch>` databases, and cloud-agent databases are excluded. Native Neon expiry bounds database cost even if GitHub cleanup fails. An open PR whose database expires needs another `/deploy <network>` before its preview works again.
- **Preview database reset:** `/reset-db <mainnet|preprod>` or `/reset-db all` resets an existing managed preview to its parent and redeploys Core. `/deploy <network|all> --reset-db` resets, then deploys Web and Core; without a network it shows help. The flag must be on the first line. Preview-only data is lost. Use this after renaming a migration already applied in the preview.
- **Database migrations:** Core's Vercel build runs `prisma migrate deploy` after a successful app build and before activation. Preview builds require `DATABASE_URL_UNPOOLED`; production continues using the integration's URLs. Web never receives database credentials or runs migrations. See [Core deployment](./apps/core/README.md#deployment-vercel).

### Preview workflow cutover

1. Keep the existing Vercel Git `main` settings and Production Neon connections for both networks. Create or verify the `preview-database` GitHub environment, limited to `main`, without required reviewers or wait timers. Every comment job enters this environment before checking the commenter's permission. Set its variables `NEON_PREVIEW_PROJECT_ID_MAINNET` and `NEON_PREVIEW_PROJECT_ID_PREPROD`; use the existing repository secrets `NEON_API_KEY` and `VERCEL_TOKEN`, and `VERCEL_TEAM_ID` variable. Both project IDs are needed for cleanup. Each project's default branch must be the intended production parent; connection lookup uses `neondb` / `neondb_owner`.
2. Disable Neon integration branching and credential injection for **Preview** on the connected Vercel projects. Preserve **Production** connections and their pooled/unpooled URLs. Do not uninstall the integration or delete its databases. Verify the integration has no remaining Preview scope before merging this workflow change. Provisioning refuses integration-owned Preview database variables rather than overwriting them.
3. Merge the workflow change, then comment `/deploy preprod` on an open application PR. Verify Core's migration log uses the new preview host, Web reaches matching Core, and a second `/deploy preprod` reuses the same Neon branch. Close that disposable PR and verify its deployments, variables, and database disappear. Repeat for mainnet before relying on that preview path. These checks delete only disposable preview data.
4. Inventory legacy `preview/<git-branch>` branches separately, match them to PRs and deployments, and approve an explicit deletion list. This workflow does not adopt or delete legacy previews. Existing accumulated charges will not be reversed by the cutover.

[Neon branch expiration](https://neon.com/blog/expire-neon-branches-automatically) bounds branch lifetime. [Vercel branch-scoped environment variables](https://vercel.com/docs/environment-variables) make both Core build and runtime use the selected database.

## Contributing

- We use [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) for branching and pull requests.
- Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles.
- See code style and contribution guidelines in the respective package folders.

## License

This project is licensed under the [MIT License](./LICENSE)
