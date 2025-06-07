# Sokosumi Monorepo

Sokosumi is a modern, secure, and user-focused marketplace platform. This monorepo contains all core services, including the main web application and backend sync functions.

## Project Structure

```
sokosumi/
├── web-app/         # Next.js 15 web application (TypeScript, Tailwind, Shadcn UI)
├── sync-function/   # Backend sync/worker functions (TypeScript)
├── package.json     # Monorepo root config
├── pnpm-workspace.yaml # Monorepo workspace config
└── ...              # Other config and shared files
```

- **web-app/**: Main user-facing web application (Next.js, React 19, Tailwind CSS, Shadcn UI, next-intl, Prisma, etc.)
- **sync-function/**: Background jobs, sync logic, and backend utilities (TypeScript)

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
- Copy and configure environment variables for each package (see `web-app/.env.example` and `sync-function/.env.example` if present).

## Development

### Web App
```bash
cd web-app
pnpm dev
```
- Runs the Next.js app at [http://localhost:3000](http://localhost:3000)

### Sync Function
You can trigger the sync function locally with:

```bash
cd sync-function
pnpm start
```

This runs `src/main.ts`.

Other available scripts:
- `pnpm build` — TypeScript build
- `pnpm lint` — Lint source files
- `pnpm format` — Format source files
- `pnpm doctl:install` — Install DigitalOcean serverless tools
- `pnpm doctl:connect` — Connect to DigitalOcean serverless namespace
- `pnpm doctl:deploy` — Deploy to DigitalOcean serverless

See the `sync-function/package.json` for more details.

## Testing

- Each package may have its own test scripts:
  - `pnpm test` (from within `web-app/` or `sync-function/` if available)

## Deployment

- **Staging:** All changes merged to `main` are auto-deployed to staging.
- **Production:** Maintainers create a GitHub Release (semantic versioning, e.g., `v1.0.0`) to trigger production deployment.

## Contributing

- We use [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) for branching and pull requests.
- Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles.
- See code style and contribution guidelines in the respective package folders.

## License

This project is licensed under the [MIT License](./LICENSE)
