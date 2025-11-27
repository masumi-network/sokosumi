# Sokosumi Core API Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the Sokosumi Core API service. For comprehensive monorepo guidelines, see [`../../AGENTS.md`](../../AGENTS.md).

## App-Specific Architecture

**Framework**: Hono with Node.js runtime
**Location**: `apps/core/` directory within the pnpm workspace
**Key Directories**:

- `src/routes/v1/` - API route handlers organized by version
- `src/middleware/` - Request middleware (auth, logging, etc.)
- `src/helpers/` - Response and error helpers
- `src/lib/` - Shared utilities and configurations

## Core API Structure

```
src/
├── routes/              # API route definitions
│   └── v1/             # API version 1
│       ├── agents/     # Agent-related endpoints
│       │   ├── [id]/   # Dynamic route segments
│       │   │   └── get.ts
│       │   ├── get.ts  # Route handlers
│       │   ├── index.ts # Route mounting
│       │   └── schemas.ts # Zod schemas
│       ├── users/      # User-related endpoints
│       │   ├── [id]/
│       │   │   └── get.ts
│       │   ├── me/
│       │   │   └── get.ts
│       │   ├── index.ts
│       │   └── schemas.ts
│       └── index.ts    # V1 API mounting
├── middleware/          # Request middleware
│   └── auth.ts          # Authentication middleware
├── helpers/             # Helper functions
│   ├── response.ts      # Success response helpers
│   ├── error.ts         # Error response helpers
│   ├── error-handler.ts # Global error handler
│   └── openapi.ts       # OpenAPI helper utilities
├── lib/                 # Shared utilities
│   ├── auth.ts          # Better Auth client
│   └── hono.ts          # Type-safe Hono classes
└── index.ts             # Application entry point
```

## Core-Specific Conventions

### Authentication Classes

Use type-safe Hono classes that automatically apply authentication:

```typescript
import { HonoWithAuth, OpenAPIHonoWithAuth } from "@/lib/hono";

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
import { ok, created, empty } from "@/helpers/response";

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
} from "@/helpers/error";

// ❌ Wrong
return c.json({ error: "Forbidden" }, 403);

// ✅ Correct
forbidden("You can only access your own user data");
```

Error helpers throw exceptions and have `never` return type - no `return` needed.

### Environment Variables

Environment variables are accessed via `process.env`. Common variables include:

- `PORT` - Server port (defaults to 8787)
- `API_KEY` - Internal API key for service-to-service authentication
- `BETTER_AUTH_SECRET` - Better Auth secret key
- `BETTER_AUTH_URL` - Better Auth base URL

**Note**: Environment variables are loaded via `dotenv/config` at the application entry point.

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
import type { UserAuthContext } from "@/middleware/auth";

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

Routes follow a modular pattern with separate files for each endpoint:

```typescript
// src/routes/v1/resource/get.ts
import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { resourceSchema } from "./schemas.js";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Resources"],
  responses: {
    200: jsonSuccessResponse(z.array(resourceSchema), "Retrieve all resources"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const auth = c.get("auth");
    const data = await fetchData();

    if (!data) {
      throw notFound("Resource not found");
    }

    return ok(c, resourceSchema.parse(data));
  });
}
```

Then mount it in the resource's `index.ts`:

```typescript
// src/routes/v1/resource/index.ts
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetResource from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetResource(app);

export default app;
```

### Creating OpenAPI Route Definition

Use the OpenAPI helper utilities for consistent response schemas:

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";

const dataSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .openapi("Data");

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Data"],
  responses: {
    200: jsonSuccessResponse(z.array(dataSchema), "Retrieve all data"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Handler implementation
  });
}
```

**Path Aliases**: The codebase uses `@/` path aliases configured in `tsconfig.json`:

- `@/helpers/*` → `src/helpers/*`
- `@/lib/*` → `src/lib/*`
- `@/routes/*` → `src/routes/*`

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
- [Hono Node.js Server](https://hono.dev/getting-started/nodejs)
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono#middleware)
