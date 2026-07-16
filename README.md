# Sokosumi Monorepo

Sokosumi is a modern, secure, and user-focused marketplace platform. This monorepo contains all core services, including the main web application and backend sync functions.

## Project Structure

```
sokosumi/
├── apps/
│   └── web/         # Next.js 16 web application (TypeScript, Tailwind, Shadcn UI)
├── packages/
│   └── database/    # Shared database layer with Prisma and repositories
├── docs/            # Documentation (future)
├── biome.jsonc      # Root Biome configuration
├── package.json     # Monorepo root config
├── pnpm-workspace.yaml # Monorepo workspace config
└── ...              # Other config and shared files
```

- **apps/web/**: Main user-facing web application (Next.js 16, React 19.2, Tailwind CSS, Shadcn UI, next-intl, Prisma, etc.)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/) (monorepo package manager)

### Clone and Install

```bash
git clone https://github.com/yourusername/sokosumi.git
cd sokosumi
pnpm install
```

### Setup Environment

- Copy and configure environment variables for each package (see `apps/web/.env.example` if present).

## Development

### Web App

```bash
cd apps/web
pnpm dev
```

- Runs the Next.js app at [http://localhost:3000](http://localhost:3000)

Other available scripts:

- `pnpm build` — TypeScript build
- `pnpm lint` — Lint source files with Biome
- `pnpm format` — Format source files with Biome

## Testing

- The monorepo uses Vitest for unit tests.
- Run all workspace tests from the repo root with `pnpm test`.
- Run a single workspace with `pnpm --filter web test`, `pnpm --filter core test`, or `pnpm --filter @sokosumi/<package> test`.

## Deployment

- **Staging:** All changes merged to `main` are auto-deployed to staging.
- **Production:** Maintainers create a GitHub Release (semantic versioning, e.g., `v1.0.0`) to trigger production deployment.
- **Database migrations:** The Core Vercel build (`pnpm vercel-build`) runs `prisma migrate deploy` **after** a successful app build and before the deployment activates (Production and Preview). Each Preview has its own database via the Vercel Neon integration. Migrate uses `DATABASE_URL_UNPOOLED` when present (injected by Neon), otherwise `DATABASE_URL`. Web does not run migrations.

## Contributing

- We use [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) for branching and pull requests.
- Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles.
- See code style and contribution guidelines in the respective package folders.

## License

This project is licensed under the [MIT License](./LICENSE)
