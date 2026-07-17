# Sokosumi Core API

Core API service for Sokosumi, built with Hono and Node.js.

## Getting Started

### Prerequisites

- Node.js 24.x (see `engines` in `package.json`)
- pnpm (workspace package manager)

### Installation

Install dependencies from the monorepo root:

```sh
pnpm install
```

### Development

Start the development server with hot reload:

```sh
pnpm core:dev
```

The server will start at `http://localhost:8787`

### Production

Build and run the production server:

```sh
pnpm --filter core build
pnpm --filter core start
```

## Environment Configuration

Configuration is validated at startup with Zod (`src/config/env.ts`). Copy `apps/core/.env.example` to `.env` and fill in values.

### Required (typical local setup)

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Shared secret with the web app’s Better Auth config |
| `BETTER_AUTH_URL` | Public base URL of **this** Core deployment (e.g. `http://localhost:8787`). Used as Better Auth `baseURL` when not on Vercel Preview |
| `BETTER_AUTH_COOKIE_DOMAIN` | Optional shared cookie domain for Better Auth cross-subdomain cookies. Leave unset on localhost; set it explicitly in deployed environments that need shared auth cookies |
| `POSTMARK_SERVER_ID`, `POSTMARK_FROM_EMAIL` | Transactional email |
| `PAYMENT_API_URL`, `PAYMENT_API_KEY` | Masumi payment API |
| `REGISTRY_API_URL`, `REGISTRY_API_KEY` | Masumi registry API |
| `STRIPE_SECRET_KEY` | Stripe server secret |
| `ABLY_PUBLISH_ONLY_KEY` | Ably publish key |

`PORT` defaults to `8787`. See `.env.example` and `env.ts` for the full list (webhooks, OpenRouter keys, cron, blob storage, etc.).

### URLs: web app, Core, and Vercel Preview

| Variable | Purpose |
| -------- | ------- |
| `WEB_APP_BASE_URL` | Defaults to `http://localhost:3000`. Used by `getWebAppBaseUrl()` (with Vercel [related projects](https://vercel.com/docs/monorepos#related-projects) when deployed) so Core knows the browser origin for the web app |
| `VERCEL_ENV` | Optional. `preview` \| `production` \| `development` — set on Vercel |
| `VERCEL_URL` | Optional. Current deployment hostname/URL on Vercel (often set automatically) |
| `VERCEL_BRANCH_URL` | Optional. Stable branch URL on Vercel Preview |
| `VERCEL_PROJECT_PRODUCTION_URL` | Optional. Vercel [system variable](https://vercel.com/docs/projects/environment-variables/system-environment-variables): production hostname for the project |

**Better Auth public base URL:** `getBetterAuthPublicBaseUrl()` (in `src/config/env.ts`) implements the same rules as `@sokosumi/utils` `resolveBetterAuthPublicBaseUrl`: when `VERCEL_ENV=preview`, Core prefers `VERCEL_BRANCH_URL` (stable branch alias) over `VERCEL_URL` (per-deployment), then `BETTER_AUTH_URL`. When only one of `VERCEL_BRANCH_URL` / `VERCEL_URL` is on a `*.sokosumi.com` host, that one wins regardless of order. With [Preview Deployment Suffix](https://vercel.com/docs/deployments/preview-deployment-suffix) set to `preview.sokosumi.com`, those system vars already use a sokosumi host — required so magic-link verify can set session cookies with `BETTER_AUTH_COOKIE_DOMAIN=sokosumi.com`. When `VERCEL_ENV=production`, Core prefers `VERCEL_PROJECT_PRODUCTION_URL`, then `BETTER_AUTH_URL`. In other cases (including local) it uses `BETTER_AUTH_URL`.

**Web app → Core API:** configure the web app’s `CORE_APP_BASE_URL` to point at this service (e.g. `http://localhost:8787` locally).

### Optional

```bash
# Sentry
SENTRY_DSN=
SENTRY_ENVIRONMENT=   # development | staging | production

# Maintenance (HTTP 503 on all routes; read at startup)
MAINTENANCE_MODE=false
```

Maintenance mode is read at startup, so changing `MAINTENANCE_MODE` requires a restart/redeploy.

## Coworker Chat And Task Gating

Coworkers expose an explicit `capabilities` array in Core. Supported values are `chat` and `tasks`.

Core applies coworker gating in this order:

1. The coworker must be active (`archivedAt = null`)
2. The coworker must be whitelisted by an admin (`isWhitelisted = true`)
3. The requested feature must be present in `capabilities`
4. Feature-specific prerequisites apply
   - `chat` also requires `baseURL`
   - `tasks` has no extra prerequisite in Core right now

An empty `capabilities` array means the coworker has no enabled features. If `isWhitelisted` is `false`, the coworker cannot be used for chat or tasks regardless of the contents of `capabilities`.

## Coworker `baseURL`

Coworkers can store an optional `baseURL` in Core (the Responses API base URL for that coworker). Chat uses the coworker's `baseURL` as the streaming endpoint; no global env base URL or service key is used.

Core always returns `baseURL` as `string | null`. When it has not been set, API responses return `null`, and coworker chat is rejected even if `capabilities` includes `chat`.

## Sentry Integration

The core service integrates Sentry for error tracking and performance monitoring.

### Configuration

Sentry is **optional** and will gracefully skip initialization if `SENTRY_DSN` is not provided. This allows local development without Sentry.

To enable Sentry:

1. Get your Sentry DSN from your Sentry project settings
2. Add to your `.env` file:
   ```bash
   SENTRY_DSN=https://your-dsn@sentry.io/project-id
   ```
3. Restart the server

### What Gets Captured

- **Errors**: All 5xx server errors are automatically captured
- **Performance**: Request traces with 0.5% sampling rate
- **Context**: Request metadata (path, method, requestId, user info)
- **Profiling**: Performance profiling with 0.5% sampling rate

### What's NOT Captured

- 4xx client errors (validation errors, not found, etc.)
- Low sampling prevents high-volume noise

### Testing Sentry Integration

To verify Sentry is working:

1. Start the server with `SENTRY_DSN` configured
2. Check logs for: `[Sentry] Initialized`
3. Trigger a test error (e.g., invalid route or server error)
4. Check your Sentry dashboard for the error event

### Sentry Dashboard

View errors and performance data in your Sentry project dashboard.

## API Documentation

Interactive API documentation is available via Swagger UI:

- **Local**: `http://localhost:8787/doc`
- **OpenAPI Spec**: `http://localhost:8787/openapi.json`

## Architecture

### Directory Structure

```
src/
├── helpers/          # Helper functions and utilities
│   ├── error.ts           # Error response helpers
│   ├── error-handler.ts   # Global error handler
│   ├── response.ts        # Success response helpers
│   ├── credits.ts         # Credit conversion utilities
│   ├── datetime.ts        # Date/time schema utilities
│   └── openapi.ts         # OpenAPI helper utilities
├── lib/              # Shared libraries and configurations
│   ├── hono.ts            # Type-safe Hono classes
│   ├── auth.ts            # Better Auth client
│   └── sentry.ts          # Sentry initialization
├── middleware/       # Request middleware
│   ├── auth.ts            # Authentication middleware
│   └── sentry.ts          # Sentry request tracing
├── routes/           # API route handlers
│   └── v1/                # API version 1
│       ├── agents/        # Agent endpoints
│       ├── jobs/          # Job endpoints
│       └── users/         # User endpoints
├── schemas/          # Zod validation schemas
│   ├── agent.schema.ts
│   ├── job.schema.ts
│   ├── file.schema.ts
│   ├── link.schema.ts
│   └── user.schema.ts
└── index.ts          # Application entry point
```

### Key Patterns

- **Authentication**: Use `HonoWithAuth` or `OpenAPIHonoWithAuth` for protected routes
- **Database Access**: Use Prisma directly via `@sokosumi/database/client` (repositories are not used)
- **Error Handling**: Always use error helpers from `helpers/error.ts`
- **Response Format**: Use response helpers from `helpers/response.ts`
- **Validation**: Use Zod schemas from `schemas/`

See [AGENTS.md](./AGENTS.md) for detailed development guidelines.

## CORS Configuration

Browser `Origin` headers are allowed only when `resolveCorsAllowOrigin()` in `src/config/cors-allow-origin.ts` returns that origin (otherwise `Access-Control-Allow-Origin` is omitted):

| Environment | Allowed origins |
| ------------- | ---------------- |
| Production / staging (`NODE_ENV` not `development`) | `https:` only, host `sokosumi.com` or `*.sokosumi.com` |
| Local development (`NODE_ENV=development`) | Same as above, plus `http:` / `https:` with host `localhost` (any port) |

Wildcard preview hosts such as `*.vercel.app` are **not** allowlisted for CORS. Use a `*.sokosumi.com` deployment or local dev.

Additional behavior:

- Credentials enabled for session cookies and Bearer tokens
- Methods and headers are configured per route group (`/auth` vs `/v1`)
- Preflight responses set `Access-Control-Max-Age` to `TIME.CORS_MAX_AGE` (see `src/config/constants.ts`; browsers may cap effective cache duration)

Better Auth’s `trustedOrigins` in Core and the web app should stay identical: `https://app.sokosumi.com`, `https://preprod.sokosumi.com`, and `https://*.preview.sokosumi.com`; development adds `http://localhost:*` for local browsers. CORS allowlisting is broader (`https://sokosumi.com` and `https://*.sokosumi.com`); do not widen `trustedOrigins` to match — it is a CSRF allowlist for browser auth flows, not general API access control.

## Authentication

The API supports multiple authentication methods:

- **User Bearer Tokens**:
  - Better Auth API keys
  - Better Auth OAuth access tokens
- **Coworker Bearer Tokens**:
  - Dedicated coworker API keys (`coworker_*`)
- **Session Cookies**: Better Auth session cookies (web app)

Public endpoints (no authentication required):

- `/openapi.json` - OpenAPI specification
- `/doc` - Swagger UI documentation
- `/v1/agents` - List agents

All other endpoints require authentication.

## Troubleshooting

### Sentry Not Capturing Errors

1. Verify `SENTRY_DSN` is set correctly
2. Check logs for Sentry initialization message
3. Ensure error is a 5xx error (4xx are not captured)
4. Check Sentry dashboard project settings

### Authentication Issues

1. Verify `BETTER_AUTH_SECRET` matches the web app and `BETTER_AUTH_URL` reflects the **Core** public URL (on Vercel Preview, confirm `VERCEL_BRANCH_URL` is the sokosumi preview host — via Preview Deployment Suffix — so magic-link cookies work)
2. Verify the web app’s `CORE_APP_BASE_URL` points at this Core deployment
3. For browser calls from the web app, confirm the page origin is allowlisted for CORS and Better Auth `trustedOrigins` (see **CORS Configuration** above)
4. Verify coworker callers use dedicated `coworker_*` API keys where applicable
5. Check that Bearer token or session cookie is valid; review auth middleware logs

### Build Errors

If you encounter build script warnings for `@sentry/profiling-node`:

```sh
pnpm approve-builds @sentry/profiling-node
```

## Contributing

See the root [AGENTS.md](../../AGENTS.md) for monorepo-wide guidelines.
