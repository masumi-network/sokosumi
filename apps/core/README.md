# Sokosumi Core API

Core API service for Sokosumi, built with Hono and Node.js.

## Getting Started

### Prerequisites

- Node.js >= 22.16.0 < 23.0.0
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

The core service uses environment variables for configuration. Create a `.env` file in `apps/core/` with the following variables:

### Required

```bash
# Server Configuration
PORT=8787                           # Server port (default: 8787)

# Better Auth Configuration
BETTER_AUTH_SECRET=                 # Better Auth secret key
BETTER_AUTH_URL=                    # Better Auth base URL
```

### Optional

```bash
# Sentry Configuration (Error Tracking & Performance Monitoring)
SENTRY_DSN=                         # Sentry project DSN
```

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

The API supports requests from any origin while maintaining authentication:

- Dynamic origin support for universal access
- Credentials enabled for session cookies and Bearer tokens
- All standard HTTP methods supported

## Authentication

The API supports multiple authentication methods:

- **Bearer Tokens**: API keys issued via Better Auth
- **Session Cookies**: Better Auth session cookies (web app)
- **Internal Tokens**: Static API keys for automation

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

1. Verify `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set
2. Check that Bearer token or session cookie is valid
3. Review auth middleware logs

### Build Errors

If you encounter build script warnings for `@sentry/profiling-node`:

```sh
pnpm approve-builds @sentry/profiling-node
```

## Contributing

See the root [AGENTS.md](../../AGENTS.md) for monorepo-wide guidelines.
