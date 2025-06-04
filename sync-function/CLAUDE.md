# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a DigitalOcean serverless function that synchronizes agents and jobs data by making parallel API calls to a Sokosumi service. The function is triggered by a cron schedule (every minute) and calls two endpoints: `api/sync/agents` and `api/sync/jobs`.

## Common Commands

- `pnpm run build` - Compile TypeScript to `packages/masumi-sync/main/`
- `pnpm run deploy` - Deploy function to DigitalOcean using doctl
- `pnpm run lint` - Run ESLint with strict TypeScript rules
- `pnpm run format` - Format code with Prettier

## Architecture

The function consists of a single entry point (`src/main.ts`) that:
1. Validates required environment variables (`SOKOSUMI_URL`, `ADMIN_KEY`)
2. Makes parallel API calls using a shared `callApi` utility
3. Returns structured responses with error handling

### Environment Variables
- `SOKOSUMI_URL` - Base URL for the API endpoints
- `ADMIN_KEY` - Admin API key for authentication (sent as `admin-api-key` header)

### DigitalOcean Configuration
The `project.yml` defines the serverless function with:
- Runtime: Node.js 18
- Cron trigger: every minute (`* * * * *`)
- Web-accessible endpoint

### Code Standards
- ESLint enforces strict import organization and TypeScript best practices
- `process.env` usage is restricted - use validation functions instead (though main.ts has an exception)
- Relative imports are discouraged except within same folder
- All unused imports/variables must be prefixed with `_`

## Build Output
TypeScript compiles to `packages/masumi-sync/main/main.js` which is the entry point defined in `package.json` and referenced by DigitalOcean.