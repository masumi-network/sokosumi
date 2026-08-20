# Sokosumi Web App

The web-app provides a user interface to interact with the agents. In the background it uses services such as:

- [Masumi Payment](https://github.com/masumi-network/masumi-payment-service)
- [Masumi Registry](https://github.com/masumi-network/masumi-registry-service)

## Monorepo Structure

This project is part of the Sokosumi monorepo. The main packages are:

- `apps/web` — This Next.js web application

Install dependencies from the root of the monorepo:

```bash
pnpm install
```

## Project Structure

```
apps/web
├── src/               # Main Code folder
    |── app            # App router
    |── lib            # Libraries and business logic
└── package.json       # Package configuration
```

## Features

- **Next.js Web Application**: Modern, server-side rendered React application
- **TypeScript**: Type-safe development environment
- **Core API client**: Generated OpenAPI client for type-safe reads and writes (no direct Postgres access from web)
- **TailwindCSS**: Utility-first CSS framework
- **Vitest**: Testing framework
- **ESLint**: Code linting
- **Docker**: Containerization support
- **Conventional Commits**: Standardized commit messages

## Prerequisites

- [Node.js](https://nodejs.org/en) (v20 or higher)
- [pnpm](https://pnpm.io/)

## URLs

- **Preprod**: [https://preprod.sokosumi.com/](https://preprod.sokosumi.com/)
- **Mainnet**: [https://app.sokosumi.com/](https://app.sokosumi.com)

## Getting Started

1. Install dependencies (from the monorepo root):

   ```bash
   pnpm install
   ```

2. Set up environment variables from the repo root:

   ```bash
   pnpm env:bootstrap
   ```

3. Start the stack from the repo root:

   ```bash
   pnpm portless:dev     # web + core
   pnpm portless:web     # web only (named Core URL still injected)
   ```

   Web is at `https://web.sokosumi.localhost` (`pnpm exec portless get web.sokosumi`). Classic `pnpm dev` in this package still binds [http://localhost:3000](http://localhost:3000).

## Development

### Available Scripts

- `pnpm dev` - Start the development server
- `pnpm build` - Build the application
- `pnpm start` - Start the production server
- `pnpm test` - Run tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm lint` - Run Biome lint rules
- `pnpm check` - Run full Biome checks

## Testing

Run tests using Vitest with the `happy-dom` browser-like environment:

```bash
pnpm test
```

### Deployment (Vercel)

[`vercel.json`](./vercel.json) sets `installCommand` to `pnpm install --filter web...` so only the web app and its workspace deps (`@sokosumi/chat`, `@sokosumi/email`, `@sokosumi/masumi`, `@sokosumi/net`, `@sokosumi/utils`) are installed. `@sokosumi/database` is not a dependency and is not built on web deploys — no Neon/`DATABASE_URL*` vars are required.

### Database setup

The web app does not connect to Postgres directly. Bootstrap the database from the repo root (`pnpm prisma:migrate:dev`, `pnpm prisma:generate`) and configure `apps/core/.env` — see the root `AGENTS.md` setup section.

Domain types come from the generated Core client (`src/lib/clients/generated/core`); see `src/lib/types/core-dto.ts` and `apps/web/AGENTS.md` (Database Access). After changing Core API schemas, regenerate the web client with `pnpm --filter web generate:core:snapshot`.

## Related Packages

- See `../sync-function/README.md` for information about backend sync/worker functions.
