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
- `src/schemas/` - Zod schemas for API validation

## Core API Structure

```
src/
├── routes/              # API route definitions
│   └── v1/             # API version 1
│       ├── agents/     # Agent-related endpoints
│       │   ├── [id]/   # Dynamic route segments
│       │   │   └── get.ts
│       │   ├── get.ts  # Route handlers
│       │   └── index.ts # Route mounting
│       ├── jobs/       # Job-related endpoints
│       │   ├── [id]/
│       │   │   ├── files/
│       │   │   │   └── get.ts  # Get files for job
│       │   │   ├── links/
│       │   │   │   └── get.ts  # Get links for job
│       │   │   └── get.ts      # Get job by ID
│       │   ├── get.ts          # List all jobs
│       │   └── index.ts
│       ├── users/      # User-related endpoints
│       │   ├── [id]/
│       │   │   ├── files/
│       │   │   │   └── get.ts  # Get files for user
│       │   │   ├── links/
│       │   │   │   └── get.ts  # Get links for user
│       │   │   └── get.ts      # Get user by ID
│       │   ├── me/
│       │   │   ├── files/
│       │   │   │   └── get.ts  # Get current user files
│       │   │   ├── links/
│       │   │   │   └── get.ts  # Get current user links
│       │   │   └── get.ts      # Get current user
│       │   └── index.ts
│       └── index.ts    # V1 API mounting
├── middleware/          # Request middleware
│   └── auth.ts          # Authentication middleware
├── helpers/             # Helper functions
│   ├── response.ts      # Success response helpers
│   ├── error.ts         # Error response helpers
│   ├── error-handler.ts # Global error handler
│   ├── openapi.ts       # OpenAPI helper utilities
│   ├── credits.ts       # Credit conversion helpers
│   └── datetime.ts      # Datetime schema utilities
├── lib/                 # Shared utilities
│   ├── auth.ts          # Better Auth client
│   └── hono.ts          # Type-safe Hono classes
├── schemas/             # Zod validation schemas
│   ├── agent.schema.ts  # Agent schemas
│   ├── job.schema.ts    # Job schemas
│   ├── file.schema.ts   # File/blob schemas
│   ├── link.schema.ts   # Link schemas
│   └── user.schema.ts   # User schemas
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
- `BETTER_AUTH_SECRET` - Better Auth secret key
- `BETTER_AUTH_URL` - Better Auth base URL

**Note**: Environment variables are loaded via `dotenv/config` at the application entry point.

### Authentication Context

Routes using `HonoWithAuth` or `OpenAPIHonoWithAuth` have access to `AuthContext`:

```typescript
const auth = c.get("auth");

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

**Alternative**: Access user directly from context variables:

```typescript
const { user } = c.var;

if (!user) {
  throw unauthorized("Unauthorized");
}

// user.id and user.organizationId are now available
```

**Authentication sources**: The shared `requireAuth` middleware accepts:

- Static API key (internal automation)
- User API key issued via Better Auth
- Better Auth session cookies (see [Better Auth Hono middleware](https://www.better-auth.com/docs/integrations/hono#middleware))

### Credit Conversion

Use the credit helpers for converting between cents (stored) and credits (user-facing):

```typescript
import {
  convertCentsToCredits,
  convertCreditsToCents,
} from "@/helpers/credits";

// Convert stored BigInt cents to user-facing decimal
const credits = convertCentsToCredits(BigInt(1000000000000)); // 1.0

// Convert user-facing decimal to stored BigInt cents
const cents = convertCreditsToCents(1.0); // BigInt(1000000000000)
```

**Note**: Credits use base 10^12 for precision (1 credit = 10^12 cents).

### Datetime Schemas

Use the reusable datetime schema for consistent date handling:

```typescript
import { dateTimeSchema } from "@/helpers/datetime";

const schema = z.object({
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});
```

This schema automatically converts Date objects to ISO strings and validates ISO datetime format.

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

import { resourceSchema } from "@/schemas/resource.schema.js";

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
    const { user } = c.var;
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

### Accessing Job-Related Resources

Jobs have associated files (blobs) and links that can be accessed through dedicated endpoints:

```typescript
// Get files for a job
const files = await blobRepository.getBlobsByUserIdAndJobId(userId, jobId);

// Get links for a job
const links = await linkRepository.getLinksByUserIdAndJobId(userId, jobId);

// Get all files for current user
const userFiles = await blobRepository.getBlobsByUserId(userId);

// Get all links for current user
const userLinks = await linkRepository.getLinksByUserId(userId);
```

**Path Aliases**: The codebase uses `@/` path aliases configured in `tsconfig.json`:

- `@/helpers/*` → `src/helpers/*`
- `@/lib/*` → `src/lib/*`
- `@/routes/*` → `src/routes/*`
- `@/schemas/*` → `src/schemas/*`

## Core API Gotchas

### Authentication

- `HonoWithAuth` and `OpenAPIHonoWithAuth` automatically apply auth middleware
- Don't manually call `app.use("*", requireAuth)` when using these classes
- Internal tokens have full access; user tokens and session-authenticated requests are scoped to the authenticated user
- Session cookies must be forwarded with requests (`credentials: "include"`) and rely on the Better Auth handler configuration documented above
- Use `c.var.user` for direct user access, or `c.get("auth")` for full auth context

### Error Handling

- Error helpers throw exceptions - they don't return
- Always provide clear, user-facing error messages
- Global error handler formats all errors consistently

### Response Format

- All success responses use `data` + `meta` structure
- All error responses use `error` + `message` + `meta` structure
- Don't create custom response formats

### Credit Handling

- Credits are stored as BigInt cents (base 10^12)
- Always use `convertCentsToCredits()` when returning credit values to users
- Use `convertCreditsToCents()` when storing user-provided credit values
- Take absolute value when displaying credits: `Math.abs(convertCentsToCredits(amount))`

### File/Blob Resources

- Files have different behaviors based on `origin`:
  - `INPUT` files require `fileUrl` (uploaded to storage)
  - `OUTPUT` files require `sourceUrl` (external URLs from agent results)
- Files are scoped to users and jobs
- Always verify user ownership before returning file data

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Response Guidelines](.cursor/rules/responses.mdc) - Response helper documentation
- [Hono Documentation](https://hono.dev/)
- [Hono Node.js Server](https://hono.dev/getting-started/nodejs)
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono#middleware)
