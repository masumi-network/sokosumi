# Core route patterns

Required before adding, changing, or removing a Core `/v1` route; [`apps/core/AGENTS.md`](../../apps/core/AGENTS.md) points here.
Paths are relative to `apps/core/` unless stated otherwise.

## Creating a New Route

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

## Creating OpenAPI Route Definition

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

## Endpoint Migration Pattern (`/{id}` to `/me`)

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
- Remove deprecated routes and duplicated logic once clients are migrated, as [Removing an Operation](#removing-an-operation) defines.

## Removing an Operation

A client counts as migrated only when every installed Apple build has stopped calling the operation. Installed builds keep calling whatever their CoreAPI snapshot selected, so removing an operation (method and path) that any version of `apps/apple/Packages/CoreAPI/Sources/CoreAPI/openapi.json` ever selected is a one-way door: those builds get a 404. A build that sends `X-Sokosumi-Client` reads the 404's `route_not_found` kind and tells the person to update; an older build shows "Couldn't reach Core. Check your connection and try again."

A PR that removes such an operation:

1. Lists each removed operation the Apple app ever selected. From the repository root, `git log -S'<path>' -- apps/apple/Packages/CoreAPI/Sources/CoreAPI/openapi.json` shows when the snapshot added and dropped it.
2. States which installed builds break (every build published from `main` before the Apple commit that dropped the operation) and the message they show.
3. Names the first published build that no longer calls it. Before merge, `MACOS_MINIMUM_BUILD` on production Core is raised to that build, so older builds get 426 `client_update_required` and an update prompt instead. [ADR 0053](../adr/0053-core-turns-away-outdated-apple-builds.md) has the header and how to find a build number.
4. Gets the user's explicit go-ahead before merge.

`src/routes/v1/apple-client-operations.openapi.test.ts` fails while the in-tree snapshot still selects an operation Core no longer serves. Refreshing the snapshot clears the test, not the installed builds, so the four steps still apply.

Only Core's catch-all answers `route_not_found`. Never answer a missing resource with that kind: the app would tell the person to update.

## Cursor-Based Pagination

**Always use cursor-based pagination for list endpoints** that may return large datasets. This ensures consistent performance and a better user experience.

### Required Imports

```typescript
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { jsonPaginatedSuccessResponse } from "@/helpers/openapi";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { ok } from "@/helpers/response";
```

### Route Definition

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

### Implementation Pattern

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

### Key Requirements

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

### Example: Reference Implementation

See `apps/core/src/routes/v1/coworkers/me/events/get.ts` and `apps/core/src/routes/v1/chats/rooms/[id]/messages/get.ts` for complete reference implementations.

## Accessing Job-Related Resources

Jobs have associated files (blobs) and links that can be accessed through Prisma queries:

```typescript
import prisma from "@/lib/db/prisma";
import { flattenLinkJobId, linkWithJobIdInclude } from "@/types/link";

// Get files for a job
const blobs = await prisma.blob.findMany({
  where: { event: { jobId } },
  include: {
    event: {
      select: {
        jobId: true,
      },
    },
  },
});
const files = blobs.map((blob) => ({
  ...blob,
  jobId: blob.event.jobId,
  size: blob.size ? Number(blob.size) : null,
}));

// Get links for a job
const links = await prisma.link.findMany({
  where: { event: { jobId } },
  include: linkWithJobIdInclude,
});
const flattenedLinks = links.map(flattenLinkJobId);
```
