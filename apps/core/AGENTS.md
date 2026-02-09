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
│   ├── auth/            # Better Auth routes
│   ├── debug/           # Debug endpoints
│   └── v1/              # API version 1
│       ├── agents/      # Agent-related endpoints
│       │   ├── [id]/    # Dynamic route segments
│       │   │   ├── get.ts           # Get agent by ID
│       │   │   ├── input-schema/    # Agent input schema
│       │   │   └── jobs/            # Agent jobs
│       │   ├── get.ts   # List all agents
│       │   └── index.ts # Route mounting
│       ├── jobs/        # Job-related endpoints
│       │   ├── [id]/
│       │   │   ├── events/      # Job events
│       │   │   ├── files/       # Job files
│       │   │   ├── links/       # Job links
│       │   │   ├── inputs/      # Provide job input
│       │   │   └── input-request/ # Get pending input request
│       │   ├── get.ts           # List jobs
│       │   └── index.ts
│       ├── users/       # User-related endpoints
│       │   ├── me/
│       │   │   ├── credits/      # User credits
│       │   │   ├── files/        # User files
│       │   │   ├── links/        # User links
│       │   │   ├── onboarding/   # User onboarding
│       │   │   ├── organizations/# User organizations
│       │   │   └── preferences/  # User preferences
│       │   ├── post.ts          # Create user
│       │   └── registered/      # Check if registered
│       └── index.ts     # V1 API mounting
├── clients/             # External API clients
│   ├── masumi-payment.client.ts
│   ├── masumi-registry.client.ts
│   ├── openrouter.client.ts
│   ├── postmark.client.ts
│   ├── stripe.client.ts
│   └── webhook.client.ts
├── config/              # Configuration
│   ├── constants.ts     # App constants
│   └── env.ts           # Environment config
├── middleware/          # Request middleware
│   ├── auth.ts          # Authentication middleware
│   ├── organization.ts  # Organization middleware
│   └── sentry.ts        # Sentry error tracking
├── helpers/             # Helper functions
│   ├── response.ts      # Success response helpers
│   ├── error.ts         # Error response helpers
│   ├── error-handler.ts # Global error handler
│   ├── openapi.ts       # OpenAPI helper utilities
│   └── datetime.ts      # Datetime schema utilities
├── lib/                 # Shared utilities
│   ├── auth.ts          # Better Auth client
│   ├── blob.ts          # Blob storage utilities
│   ├── db/prisma.ts     # Prisma client
│   ├── email/           # Email templates
│   ├── hono.ts          # Type-safe Hono classes
│   ├── i18next.ts       # Internationalization
│   └── sentry.ts        # Sentry setup
├── locales/             # Translation files
│   └── en/              # English translations
├── schemas/             # Zod validation schemas
│   ├── agent.schema.ts
│   ├── job.schema.ts
│   ├── file.schema.ts
│   ├── link.schema.ts
│   ├── organization.schema.ts
│   └── user.schema.ts
├── services/            # Business logic services
│   ├── stripe.service.ts
│   └── webhook.service.ts
├── types/               # TypeScript types
│   ├── agent.ts
│   ├── blob.ts
│   ├── job.ts
│   └── link.ts
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

**Note**: Credits use base 10^10 for precision (1 credit = 10^10 cents).

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

| Command                           | Purpose                  |
| --------------------------------- | ------------------------ |
| `pnpm core:dev`                   | Start development server |
| `pnpm core:build`                 | Build for production     |
| `pnpm core:start`                 | Run production build     |
| `pnpm --filter core lint`         | Lint core app            |
| `pnpm --filter core generate:api` | Regenerate API clients   |

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

### Cursor-Based Pagination

**Always use cursor-based pagination for list endpoints** that may return large datasets. This ensures consistent performance and a better user experience.

#### Required Imports

```typescript
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { jsonPaginatedSuccessResponse } from "@/helpers/openapi";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { ok } from "@/helpers/response";
```

#### Route Definition

Use `cursorPaginationQuerySchema` for query parameters and `jsonPaginatedSuccessResponse` for the response:

```typescript
const route = createRoute({
  method: "get",
  path: "/{id}/items",
  description: "Get items (paginated)",
  tags: ["Resources"],
  request: {
    params: paramsSchema,
    query: cursorPaginationQuerySchema, // Standard pagination query params
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(itemSchema),
      "Items retrieved successfully",
      {
        data: [/* example items */],
        meta: {
          timestamp: "2025-01-21T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 100,
            nextCursor: "item_id_123",
          },
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});
```

#### Implementation Pattern

Follow this exact pattern for consistent pagination:

```typescript
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const queryParams = c.req.valid("query");

    // Parse pagination parameters
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1; // Fetch one extra to detect hasMore

    // Build where clause
    const where = {
      resourceId: id,
      // Add other filters as needed
    };

    // Fetch items and count in parallel
    const [items, count] = await prisma.$transaction([
      prisma.resourceItem.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], // Always include id for stable pagination
      }),
      prisma.resourceItem.count({ where }),
    ]);

    // Determine if there are more items
    const hasMore = items.length === takePlusOne;
    const pagedItems = items.slice(0, take); // Remove the extra item

    // Create pagination metadata
    const paginationMeta = createPaginationMeta(
      pagedItems,
      count,
      take,
      hasMore,
      cursor,
    );

    // Return response with pagination metadata
    return ok(c, z.array(itemSchema).parse(pagedItems), paginationMeta);
  });
}
```

#### Key Requirements

1. **Query Schema**: Always use `cursorPaginationQuerySchema` - it provides `cursor` (optional string) and `limit` (number, defaults to 20, max 100)

2. **Response Schema**: Use `jsonPaginatedSuccessResponse` instead of `jsonSuccessResponse` for paginated endpoints

3. **Take + 1 Pattern**: Always fetch `take + 1` items to detect if there are more pages without an extra count query

4. **Ordering**: Always include `id` as a secondary sort field for stable pagination:
   ```typescript
   orderBy: [{ createdAt: "asc" }, { id: "asc" }]
   ```

5. **Pagination Metadata**: Use `createPaginationMeta()` helper which automatically:
   - Sets `cursor` (current cursor or null)
   - Sets `limit` (items per page)
   - Sets `total` (total count)
   - Sets `nextCursor` (ID of last item if hasMore, otherwise null)

6. **Response Helper**: Pass pagination metadata as the third parameter to `ok()`:
   ```typescript
   return ok(c, data, paginationMeta);
   ```

#### Example: Reference Implementation

See `apps/core/src/routes/v1/coworkers/[id]/events/get.ts` and `apps/core/src/routes/v1/conversations/[id]/items/get.ts` for complete reference implementations.

### Accessing Job-Related Resources

Jobs have associated files (blobs) and links that can be accessed through Prisma queries:

```typescript
import prisma from "@sokosumi/database/client";
import { blobWithJobIdInclude, flattenBlobJobId } from "@/types/blob";
import { linkWithJobIdInclude, flattenLinkJobId } from "@/types/link";

// Get files for a job
const blobs = await prisma.blob.findMany({
  where: { event: { jobId } },
  include: blobWithJobIdInclude,
});
const files = blobs.map(flattenBlobJobId);

// Get links for a job
const links = await prisma.link.findMany({
  where: { event: { jobId } },
  include: linkWithJobIdInclude,
});
const flattenedLinks = links.map(flattenLinkJobId);

// Get all files for current user
const userBlobs = await prisma.blob.findMany({
  where: { userId },
  include: blobWithJobIdInclude,
});
const userFiles = userBlobs.map(flattenBlobJobId);

// Get all links for current user
const userLinks = await prisma.link.findMany({
  where: { userId },
  include: linkWithJobIdInclude,
});
const flattenedUserLinks = userLinks.map(flattenLinkJobId);
```

**Note**: The core API uses the `@sokosumi/database` package for Prisma queries. Repository pattern has been removed in favor of direct Prisma queries with type-safe includes and flatten helpers.

**Shared Packages**:

- `@sokosumi/database` - Database layer with Prisma client and repositories
- `@sokosumi/masumi` - Masumi protocol utilities (hash, agent client, schemas)

**Path Aliases**: The codebase uses `@/` path aliases configured in `tsconfig.json`:

- `@/helpers/*` → `src/helpers/*`
- `@/lib/*` → `src/lib/*`
- `@/routes/*` → `src/routes/*`
- `@/schemas/*` → `src/schemas/*`

### Testing (Vitest)

Environment variables required by Vitest (or by code under test) must be set in **`src/test/setup.ts`**. Add new keys to the `envDefaults` object there so tests run with predictable values and without relying on `.env`. Do not add test-only env vars to `.env.example`; keep them in the test setup.

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

- Credits are stored as BigInt cents (base 10^10)
- Always use `convertCentsToCredits()` when returning credit values to users
- Use `convertCreditsToCents()` when storing user-provided credit values
- Take absolute value when displaying credits: `Math.abs(convertCentsToCredits(amount))`

### File/Blob Resources

- Files have different behaviors based on `origin`:
  - `INPUT` files require `fileUrl` (uploaded to storage)
  - `OUTPUT` files require `sourceUrl` (external URLs from agent results)
- Files are scoped to users and jobs
- Always verify user ownership before returning file data

## Additional Rules

- [Responses](.cursor/rules/responses.mdc)

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Hono Documentation](https://hono.dev/)
- [Hono Node.js Server](https://hono.dev/getting-started/nodejs)
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono#middleware)
