# Masumi Sync Function

This is a TypeScript-based function for syncing Masumi services. It can be run locally or deployed as a serverless function (e.g., on DigitalOcean).

## Prerequisites

- Node.js 18 or later
- [pnpm](https://pnpm.io/) (recommended)
- DigitalOcean CLI (`doctl`) if deploying to DigitalOcean

## Environment Variables

- `SOKOSUMI_URL`: The base URL of the Sokosumi API to call
- `ADMIN_KEY`: Admin API key for authentication

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build the TypeScript code:

   ```bash
   pnpm build
   ```

3. Set up your environment variables (locally or in your deployment platform):
   - `SOKOSUMI_URL`: The base URL of the Sokosumi API
   - `ADMIN_KEY`: Admin API key

## Local Development & Testing

You can run the sync function locally:

```bash
pnpm start
```

This runs `src/main.ts` and prints the result to the console.

## Available Scripts

- `pnpm start` — Run the sync function locally
- `pnpm build` — Compile TypeScript
- `pnpm lint` — Lint source files
- `pnpm format` — Format source files
- `pnpm doctl:install` — Install DigitalOcean serverless tools
- `pnpm doctl:connect` — Connect to DigitalOcean serverless namespace
- `pnpm doctl:deploy` — Deploy to DigitalOcean serverless

## Deployment

Deploy the function using the DigitalOcean CLI:

```bash
pnpm doctl:deploy
```

See `package.json` for more details on available scripts.
