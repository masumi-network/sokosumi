# Sokosumi Core API Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the Sokosumi Core API service. For comprehensive monorepo guidelines, see [`../../AGENTS.md`](../../AGENTS.md).

## App-Specific Architecture

**Framework**: Hono
**Location**: `apps/core/` directory within the pnpm workspace
**Key Directories**:

- `src/routes/` - API route handlers
- `src/middleware/` - Request middleware (auth, logging, etc.)
- `src/helpers/` - Response and error helpers
- `src/lib/` - Shared utilities and configurations
- `src/config/` - Environment configuration

## Core API Structure

```
src/
├── routes/              # API route definitions
│   ├── agents.ts        # Agent-related endpoints
│   └── users.ts         # User-related endpoints
├── middleware/          # Request middleware
│   └── auth.ts          # Authentication middleware
├── helpers/             # Helper functions
│   ├── response.ts      # Success response helpers
│   ├── error.ts         # Error response helpers
│   └── error-handler.ts # Global error handler
├── lib/                 # Shared utilities
│   ├── auth.ts          # Better Auth client
│   └── hono.ts          # Type-safe Hono classes
├── config/              # Configuration
│   └── env.ts           # Environment variables
└── index.ts             # Application entry point
```

## Core-Specific Conventions

### Authentication Classes

Use type-safe Hono classes that automatically apply authentication:

```typescript
import { HonoWithAuth, OpenAPIHonoWithAuth } from "../lib/hono";

// For standard routes
const router = new HonoWithAuth();

// For OpenAPI-documented routes
const app = new OpenAPIHonoWithAuth();
```

**Important**: These classes automatically apply `requireAuth` middleware - do not add it manually.

### Response Handling

**CRITICAL**: Always use standardized response helpers. See [`.cursor/rules/responses.mdc`](.cursor/rules/responses.mdc) for details.

#### Success Responses

```typescript
import { ok, created, empty } from "../helpers/response";

// Return data
return ok(c, { user });

// Return newly created resource
return created(c, { resource });

// No content to return
return empty(c);
```

#### Error Responses

**NEVER** use `c.json({ error: "..." }, statusCode)` directly:

```typescript
import {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessableEntity,
} from "../helpers/error";

// ❌ Wrong
return c.json({ error: "Forbidden" }, 403);

// ✅ Correct
forbidden("You can only access your own user data");
```

Error helpers throw exceptions and have `never` return type - no `return` needed.

### Environment Variables

Use the typed `env` object from `src/config/env.ts`:

```typescript
import { env } from "../config/env";

// Access environment variables
const port = env.PORT;
const apiKey = env.API_KEY;
```

**Never** access `process.env` directly in route handlers.

### Authentication Context

Routes using `HonoWithAuth` or `OpenAPIHonoWithAuth` have access to `AuthContext`:

```typescript
const auth = c.get("auth");

if (auth.type === "internal") {
  // Internal service token
}

if (auth.type === "user") {
  // User token with userId and organizationId
  const userId = auth.userId;
  const orgId = auth.organizationId;
  const sessionId = auth.sessionId; // null for API keys, string for session cookies
}
```

**Type narrowing**: When checking auth type, use type assertions for TypeScript:

```typescript
import type { UserAuthContext } from "../middleware/auth";

if (auth.type !== "user") {
  forbidden("Internal tokens cannot access user data");
}

const userAuth = auth as UserAuthContext;
const userId = userAuth.userId; // Now type-safe
const sessionId = userAuth.sessionId;
```

**Authentication sources**: The shared `requireAuth` middleware accepts:

- Static API key (internal automation)
- User API key issued via Better Auth
- Better Auth session cookies (see [Better Auth Hono middleware](https://www.better-auth.com/docs/integrations/hono#middleware))

## App-Specific Commands

| Command         | Purpose                  |
| --------------- | ------------------------ |
| `pnpm core:dev` | Start development server |

## Common Patterns

### Creating a New Route

```typescript
import { OpenAPIHonoWithAuth } from "../lib/hono";
import { ok } from "../helpers/response";
import { notFound } from "../helpers/error";

const app = new OpenAPIHonoWithAuth();

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth");

  // Your logic here
  const data = await fetchData(id);
  if (!data) {
    notFound("Resource not found");
  }

  return ok(c, data);
});

export default app;
```

### Creating OpenAPI Route Definition

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import { successResponseSchema } from "../helpers/response";

const dataSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .openapi("Data");

const route = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(z.array(dataSchema)),
        },
      },
      description: "Retrieve all data",
    },
  },
});

app.openapi(route, async (c) => {
  // Handler implementation
});
```

## Core API Gotchas

### Authentication

- `HonoWithAuth` and `OpenAPIHonoWithAuth` automatically apply auth middleware
- Don't manually call `app.use("*", requireAuth)` when using these classes
- Internal tokens have full access; user tokens and session-authenticated requests are scoped to the authenticated user
- Session cookies must be forwarded with requests (`credentials: "include"`) and rely on the Better Auth handler configuration documented above

### Error Handling

- Error helpers throw exceptions - they don't return
- Always provide clear, user-facing error messages
- Global error handler formats all errors consistently

### Response Format

- All success responses use `data` + `meta` structure
- All error responses use `error` + `message` + `meta` structure
- Don't create custom response formats

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Response Guidelines](.cursor/rules/responses.mdc) - Response helper documentation
- [Hono Documentation](https://hono.dev/)
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono#middleware)
