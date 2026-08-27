# Sokosumi Monorepo

Sokosumi is a marketplace platform. This monorepo is the web app, the Core API, and shared packages.

## Project Structure

```
sokosumi/
├── apps/
│   ├── web/         # Next.js 16 web app (TypeScript, Tailwind, Shadcn UI)
│   └── core/        # Hono API — owns all Postgres/Prisma access
├── packages/
│   ├── database/    # @sokosumi/database — Prisma client, helpers, repositories
│   ├── masumi/      # @sokosumi/masumi — protocol clients, hash, schemas
│   ├── utils/       # @sokosumi/utils — client-safe helpers
│   ├── net/         # @sokosumi/net — SSRF-safe fetch
│   ├── email/       # @sokosumi/email — renderers and locales
│   ├── chat/        # @sokosumi/chat — chat types
│   └── ai-provider/ # @sokosumi/ai-provider — Sokosumi AI SDK provider
├── docs/            # Agent, domain, coworker, and design docs
├── skills/          # First-party agent skill sources
├── biome.jsonc      # Root Biome configuration
├── package.json     # Monorepo root config
└── pnpm-workspace.yaml
```

- **apps/web/**: User-facing web application (Next.js 16, React 19.2, Tailwind CSS, Shadcn UI, next-intl). Reaches data only through the Core API — it does not use Prisma.
- **apps/core/**: Hono API on Node.js. All database reads and writes live here.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x
- [pnpm](https://pnpm.io/) (monorepo package manager)

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

Copies `apps/web/.env.example` and `apps/core/.env.example` to `.env` when missing, replaces Zod-breaking placeholders, comments production `BETTER_AUTH_COOKIE_DOMAIN` in `.env` (portless injects `sokosumi.localhost` at runtime), and sets web `APP_SIGNING_SECRET` equal to Core `BETTER_AUTH_SECRET`. Grok copies (`.git/grok-worktree-source`) and linked git worktrees reuse the primary checkout `.env` so `BETTER_AUTH_SECRET` / `DATABASE_URL` match — unless the worktree already has a unique secret.

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
```

- Web: `https://web.sokosumi.localhost` (`pnpm portless:url web`)
- Core: `https://core.sokosumi.localhost` (`pnpm portless:url core`) — OpenAPI at `/v1/openapi.json`

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
- `pnpm lint` — Lint source files with Biome
- `pnpm format` — Format source files with Biome

## Testing

- The monorepo uses Vitest for unit tests.
- Name tests `*.test.ts(x)` and place them next to the source they cover (`foo.test.ts` beside `foo.ts`). Use `__tests__/` only when a test does not map 1:1 to a single source file.
- Run all workspace tests from the repo root with `pnpm test`.
- Run a single workspace with `pnpm --filter web test`, `pnpm --filter core test`, or `pnpm --filter @sokosumi/<package> test`.

## Deployment

- **Staging:** All changes merged to `main` are auto-deployed to staging.
- **Production:** Maintainers create a GitHub Release (semantic versioning, e.g., `v1.0.0`) to trigger production deployment.
- **Database migrations:** The Core Vercel build (`pnpm vercel-build`) runs `prisma migrate deploy` **after** a successful app build and before the deployment activates (Production and Preview). With the Vercel Neon integration, each Preview gets its own database branch; Preview builds require `DATABASE_URL_UNPOOLED` so migrate cannot silently target a shared/production URL. Migrate prefers `DATABASE_URL_UNPOOLED`, otherwise `DATABASE_URL`. Web does not run migrations and its Vercel install is filtered (`pnpm install --filter web...`) so `@sokosumi/database` is not installed or built. See [apps/core/README.md](./apps/core/README.md#deployment-vercel) for the Neon checklist.

## Contributing

- We use [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) for branching and pull requests.
- Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles.
- See code style and contribution guidelines in the respective package folders.

## License

This project is licensed under the [MIT License](./LICENSE)
