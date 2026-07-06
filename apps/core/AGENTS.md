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

### Concurrency Tradeoffs

For low-frequency, user-triggered mutations that are easy to retry, last-write-wins behavior is acceptable. Prefer the simpler direct update path over extra conditional write guards when all of these are true:

- the operation is initiated manually by a user
- concurrent collisions are unlikely in practice
- retrying the action is cheap and safe

Examples include workspace move operations for tasks and jobs. Do not add `updateMany`-style stale-write guards there unless the product requirement explicitly needs conflict detection.

#### Serializable Transactions

When a flow does need `Serializable` isolation (e.g. credit consumption, idempotency checks), use `serializableTransaction()` from `@/lib/db/transaction` instead of calling `prisma.$transaction` with `isolationLevel` directly. Postgres aborts serializable transactions with a serialization failure (Prisma `P2034`) under concurrent writes; the helper maps that to a retryable 409 conflict (`kind: "concurrency_conflict"`) instead of an unhandled 500. Routes using it must declare `409: jsonErrorResponse("Conflict")` in their OpenAPI responses.

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

Environment variables are accessed via `process.env`, validated at startup with Zod in `src/config/env.ts`. See `apps/core/README.md` (Environment Configuration) for tables and `.env.example` for a full template.

**Common URL-related variables:**

- `PORT` — HTTP port (default `8787`)
- `WEB_APP_BASE_URL` — Default `http://localhost:3000`; used with `getWebAppBaseUrl()` and Vercel related projects
- `BETTER_AUTH_SECRET` — Shared with the web Better Auth instance
- `BETTER_AUTH_URL` — Public base URL of this Core service; used as Better Auth `baseURL` except on Vercel Preview
- `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` — Optional; on Preview and Production, `getBetterAuthPublicBaseUrl()` resolves the issuer URL from Vercel (see `@sokosumi/utils` `resolveBetterAuthPublicBaseUrl`)

**Note**: Environment variables are loaded via `dotenv/config` at the application entry point.

**Signup bonus** (Core only — granted on `user.create.after`, not via Stripe):

- `SIGNUP_BONUS_CREDITS` — credits per new user (default `3000`)
- `SIGNUP_BONUS_TTL_DAYS` — bucket expiry in days from grant time (default `30`)

Buckets use `referenceType: SIGNUP_BONUS` and `referenceId: user:{userId}`. Grants are idempotent per user via the `(referenceId, referenceType)` unique key.

**Operations:**

- Alert on Sentry events tagged `context:signup_bonus_grant`. Grant failures are swallowed so signup is not blocked; there is no batch backfill job.

**Free credits** (Core admin — granted via `POST /v1/admin/credits`, not via Stripe):

- Admin-only direct grants to a user or organization from the web UI at `/admin/free-credits`.
- Buckets use `referenceType: FREE`, `referenceId: free:{user|org}:{targetId}:{grantId}`, and optional `referenceNote` (free-text audit note from the admin form).
- Each grant uses a new `grantId` (UUID); repeat grants are allowed (not idempotent like signup bonus).
- Organization grants attach credits to the org bucket and record the transaction against the organization's earliest-created owner.

**Operations:**

- Run `pnpm prisma:migrate:deploy` (migration `20260706150000_add_support_credit_reference_type`) **before** deploying Core — the `FREE` enum value and `credit_bucket.referenceNote` column must exist or grants fail at runtime.

### CORS and Better Auth origins

- **CORS** (`src/config/cors-allow-origin.ts`): `Access-Control-Allow-Origin` is echoed only for `https://sokosumi.com` / `https://*.sokosumi.com` in non-development, or for `localhost` with `http`/`https` when `NODE_ENV=development`. Wildcard Vercel preview hosts are not allowlisted.
- **Better Auth** (`src/lib/auth.ts`): `trustedOrigins` lists explicit web app hosts (`https://app.sokosumi.com`, `https://preprod.sokosumi.com`, `https://*.preview.sokosumi.com`) plus in development only `http://localhost:*`. Web no longer runs Better Auth; keep this list aligned with browser origins that call Core `/auth`. CORS remains broader (`https://sokosumi.com` / `https://*.sokosumi.com`); do not widen `trustedOrigins` to match CORS — it is a CSRF allowlist, not general API access control.

Cross-origin calls from the web app require the web deployment to use a hostname that satisfies both checks (e.g. `*.sokosumi.com` in hosted environments).

### Better Auth ID generation

- `src/lib/auth.ts` sets `advanced.database.generateId: "uuid"` so Better Auth–managed rows get UUID-shaped primary keys, consistent with `@sokosumi/database` Prisma models. Do not remove this without aligning the shared schema and any database migrations.

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

For the **credits-only API contract** and **direct Prisma (no repository pattern)** conventions, see [.cursor/rules/credits-api.mdc](.cursor/rules/credits-api.mdc) and [.cursor/rules/data-access.mdc](.cursor/rules/data-access.mdc).

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

### Sync Route Pattern (Vercel)

For internal async-ack sync routes (immediate `200` response + background execution), use this pattern:

- Always use `waitUntil(...)` from `@vercel/functions` for background work.
- Do not use untracked fire-and-forget (`void` async) for long-running sync jobs.
- Locking must be ownership-safe:
  - `acquireLock` returns an owner token.
  - heartbeat updates `lockedAt` while work is running.
  - `releaseLock` uses compare-and-set (`key` + owner token).
- Add route/service tests for:
  - missing or invalid auth returns `401`
  - active lock returns `409`
  - async-ack returns `200` and starts background work once
  - timeout path keeps lock safety guarantees
  - stale ownership does not unlock a lock owned by another runner

## App-Specific Commands

| Command                           | Purpose                  |
| --------------------------------- | ------------------------ |
| `pnpm core:dev`                   | Start development server |
| `pnpm core:build`                 | Build for production     |
| `pnpm core:start`                 | Run production build     |
| `pnpm --filter core lint`         | Lint core app            |
| `pnpm --filter core write-openapi-snapshot-for-web` | Writes `apps/web/openapi-core.snapshot.json` (gitignored) from the in-memory v1 router for web `openapi-ts` |
| `pnpm --filter web generate:core:snapshot`          | Runs the snapshot script + regenerates `apps/web/src/lib/clients/generated/core` (no running Core server) |
| `pnpm --filter web generate:core`                 | Regenerates the web Core client from `http://localhost:8787/v1/openapi.json` (Core must be running)        |

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

### Endpoint Migration Pattern (`/{id}` to `/me`)

When the authentication context already identifies the caller (for example `authContext.coworkerId`), prefer self-scoped endpoints under `/me`:

- `GET /resource/me`
- `GET /resource/me/...`
- `POST /resource/me/...`

If older clients still depend on `/{id}`:

- Keep legacy `/{id}` endpoints as temporary fallback routes.
- Mark fallback operations as deprecated in OpenAPI with `deprecated: true` in `createRoute(...)`.
- Keep fallback behavior/auth checks consistent with the `/me` implementation.

Route mounting order:

- Mount static `/me` routes before dynamic `/{id}` routes to prevent path conflicts.

Required tests for migration PRs:

- Add an OpenAPI contract test that asserts:
  - `/me` endpoints exist.
  - fallback `/{id}` endpoints exist while compatibility is required.
  - fallback operations are marked `deprecated: true`.
- Add/keep auth helper tests for missing self identity (`403`) and valid self identity.

Temporary duplication rule during deprecation:

- Limited duplication between `/me` and deprecated `/{id}` handlers is acceptable during rollout.
- Duplication must be temporary and tracked with a removal ticket/sunset date.
- Remove deprecated routes and duplicated logic once clients are migrated.

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
  path: "/{id}/messages",
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

See `apps/core/src/routes/v1/coworkers/me/events/get.ts` and `apps/core/src/routes/v1/conversations/[id]/messages/get.ts` for complete reference implementations.

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
- **Never expose cents in the API**: request/response and query params use credits only; convert at the boundary with `convertCentsToCredits()` / `convertCreditsToCents()` from `@sokosumi/database/helpers`
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

- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – import from the canonical package; no passthrough re-export modules
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – shared pure helpers in `@sokosumi/utils`; Prisma-backed logic in `@sokosumi/database`
- [Credits API](.cursor/rules/credits-api.mdc) – expose credits only, never cents
- [Data Access](.cursor/rules/data-access.mdc) – direct Prisma, no repository pattern
- [Responses](.cursor/rules/responses.mdc)

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Hono Documentation](https://hono.dev/)
- [Hono Node.js Server](https://hono.dev/getting-started/nodejs)
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono#middleware)
