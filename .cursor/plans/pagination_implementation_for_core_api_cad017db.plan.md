---
name: Pagination Implementation for Core API
overview: Implement comprehensive pagination support for the Core API with both offset-based (page + pageSize) and cursor-based (cursor + limit) pagination, following REST best practices and leveraging Prisma's native pagination features.
todos:
  - id: create-pagination-schemas
    content: Create pagination schemas in apps/core/src/schemas/pagination.schema.ts with offset and cursor query schemas, plus response metadata schemas
    status: completed
  - id: create-pagination-helpers
    content: Create pagination helper functions in apps/core/src/helpers/pagination.ts for parsing params and creating metadata
    status: completed
  - id: update-response-helpers
    content: Extend ok() and created() helpers in apps/core/src/helpers/response.ts to support optional pagination metadata parameter
    status: completed
  - id: update-openapi-helpers
    content: Add paginated response helper to apps/core/src/helpers/openapi.ts for OpenAPI documentation
    status: completed
  - id: add-example-implementation
    content: Add pagination example to an existing endpoint (e.g., jobs/get.ts) demonstrating both patterns
    status: completed
---

# Pagination Implementation for Core API

## Overview

Implement pagination support for the Core API application that supports both offset-based and cursor-based pagination patterns. The implementation will follow REST API best practices and integrate seamlessly with Prisma's native pagination capabilities.

## Design Decisions

- **Offset pagination**: Uses `page` (1-indexed) + `pageSize` parameters
- **Cursor pagination**: Uses `cursor` + `limit` parameters
- **Default page size**: 20 items
- **Maximum limit**: 100 items (to prevent abuse)
- **Default cursor field**: `id` (can be customized per endpoint)
- **Response format**: Pagination metadata included in the `meta` object of existing response structure

## Implementation Plan

### 1. Create Pagination Schemas (`apps/core/src/schemas/pagination.schema.ts`)

Create reusable Zod schemas for pagination query parameters and response metadata:

**Query Parameter Schemas:**

- `offsetPaginationQuerySchema`: Validates `page` (min: 1, default: 1) and `pageSize` (min: 1, max: 100, default: 20) with OpenAPI documentation
- `cursorPaginationQuerySchema`: Validates `cursor` (optional string) and `limit` (min: 1, max: 100, default: 20) with OpenAPI documentation

**Response Metadata Schemas:**

- `offsetPaginationMetaSchema`: Schema for offset pagination metadata (page, pageSize, total, totalPages, hasNext, hasPrevious)
- `cursorPaginationMetaSchema`: Schema for cursor pagination metadata (cursor, limit, hasNext, nextCursor)

All schemas should follow the existing pattern in the codebase using `@hono/zod-openapi` with proper OpenAPI annotations.

### 2. Create Pagination Helpers (`apps/core/src/helpers/pagination.ts`)

Create utility functions to work with pagination:

**Parser Functions:**

- `parseOffsetPagination(query)`: Parses and validates offset pagination params, returns `{ skip, take, page, pageSize }` where skip = (page - 1) \* pageSize
- `parseCursorPagination(query)`: Parses and validates cursor pagination params, returns `{ cursor, limit, skip }` where skip is 1 if cursor exists (to skip the cursor record)

**Metadata Creation Functions:**

- `createOffsetPaginationMeta(data, total, page, pageSize)`: Creates pagination metadata object with calculated values (totalPages, hasNext, hasPrevious)
- `createCursorPaginationMeta(data, limit, cursorField)`: Creates pagination metadata by checking if data has more items than limit (hasNext), extracts nextCursor from the last item

**Type Exports:**

- Export TypeScript types for pagination parameters and metadata

### 3. Update Response Helpers (`apps/core/src/helpers/response.ts`)

Extend existing response helpers to support optional pagination:

- Modify `ok(c, data, paginationMeta?)`: Add optional second parameter for pagination metadata. When provided, include it in the `meta.pagination` field
- Modify `created(c, data, paginationMeta?)`: Add optional second parameter for pagination metadata. When provided, include it in the `meta.pagination` field
- Update `successResponseSchema` to optionally include pagination metadata in the meta object (use `.merge()` or `.extend()` to make pagination optional)
- Maintain backward compatibility - when pagination metadata is not provided, functions work exactly as before

The response structure should be:

```typescript
{
  data: T,
  meta: {
    timestamp: string,
    requestId: string,
    pagination?: OffsetPaginationMeta | CursorPaginationMeta
  }
}
```

Function signatures:

```typescript
export const ok = <T>(c: Context, data: T, paginationMeta?: OffsetPaginationMeta | CursorPaginationMeta) => { ... }
export const created = <T>(c: Context, data: T, paginationMeta?: OffsetPaginationMeta | CursorPaginationMeta) => { ... }
```

### 4. Update OpenAPI Helpers (`apps/core/src/helpers/openapi.ts`)

Add helper functions for OpenAPI documentation:

- `jsonPaginatedSuccessResponse(schema, paginationMetaSchema, description, example?)`: Creates OpenAPI response schema that includes pagination metadata in the meta object
- This should work with the updated `successResponseSchema` that includes optional pagination

### 5. Create Example Implementation

Update an existing list endpoint (e.g., `apps/core/src/routes/v1/jobs/get.ts`) to demonstrate both pagination patterns:

**Offset Pagination Example:**

- Add `offsetPaginationQuerySchema` to route query parameters
- Parse pagination params using `parseOffsetPagination`
- Use Prisma's `skip` and `take` with `findMany` and `count`
- Create pagination metadata and return with `ok(c, data, paginationMeta)`

**Cursor Pagination Example (as alternative or separate endpoint):**

- Add `cursorPaginationQuerySchema` to route query parameters
- Parse pagination params using `parseCursorPagination`
- Use Prisma's `cursor` and `take` with `findMany`
- Fetch `limit + 1` items to detect hasNext
- Create pagination metadata and return with `ok(c, data, paginationMeta)`

## File Structure

```
apps/core/src/
├── schemas/
│   └── pagination.schema.ts (NEW - ~150 lines)
├── helpers/
│   ├── pagination.ts (NEW - ~200 lines)
│   ├── response.ts (MODIFY - extend ok/created with optional pagination, update schema)
│   └── openapi.ts (MODIFY - add jsonPaginatedSuccessResponse)
└── routes/v1/
    └── jobs/
        └── get.ts (MODIFY - add pagination example)
```

## Key Implementation Details

### Offset Pagination Pattern

**Query parameters:** `?page=2&pageSize=20`

```typescript
// In route definition
const route = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      ...offsetPaginationQuerySchema.shape,
      // other query params
    }),
  },
});

// In route handler
app.openapi(route, async (c) => {
  const query = c.req.valid("query");
  const { skip, take, page, pageSize } = parseOffsetPagination(query);

  const [data, total] = await Promise.all([
    prisma.model.findMany({
      skip,
      take,
      // ... other query options
    }),
    prisma.model.count({
      where: {
        /* same where clause */
      },
    }),
  ]);

  const paginationMeta = createOffsetPaginationMeta(
    data,
    total,
    page,
    pageSize,
  );
  return ok(c, data, paginationMeta);
});
```

### Cursor Pagination Pattern

**Query parameters:** `?cursor=abc123&limit=20`

```typescript
// In route definition
const route = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      ...cursorPaginationQuerySchema.shape,
      // other query params
    }),
  },
});

// In route handler
app.openapi(route, async (c) => {
  const query = c.req.valid("query");
  const { cursor, limit, skip } = parseCursorPagination(query);

  const data = await prisma.model.findMany({
    take: limit + 1, // Fetch one extra to check hasNext
    skip: skip ? 1 : undefined,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: "asc" },
    // ... other query options
  });

  const paginationMeta = createCursorPaginationMeta(data, limit, "id");
  return ok(c, data.slice(0, limit), paginationMeta);
});
```

### Response Format Examples

**Offset pagination response:**

```json
{
  "data": [...],
  "meta": {
    "timestamp": "2025-01-15T12:00:00.000Z",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "pagination": {
      "page": 2,
      "pageSize": 20,
      "total": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrevious": true
    }
  }
}
```

**Cursor pagination response:**

```json
{
  "data": [...],
  "meta": {
    "timestamp": "2025-01-15T12:00:00.000Z",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "pagination": {
      "cursor": "abc123",
      "limit": 20,
      "hasNext": true,
      "nextCursor": "xyz789"
    }
  }
}
```

## Integration Points

- Follows existing patterns: Zod schemas, response helpers, OpenAPI documentation
- Integrates with Prisma's `skip`, `take`, and `cursor` parameters as documented in Prisma docs
- Maintains type safety with TypeScript and Zod
- Follows error handling patterns (uses existing validation via Zod)
- Works with existing `@hono/zod-openapi` route definitions
- Compatible with `withGlobalHeaderParameters` wrapper used in routes
- Uses existing `dateTimeSchema` from `helpers/datetime.ts` if needed for timestamps

## Testing Considerations

- Validate parameter bounds (page >= 1, pageSize/limit between 1-100)
- Test edge cases (first page, last page, empty results, single page results)
- Verify Prisma queries correctly use skip/take/cursor
- Ensure backward compatibility with non-paginated endpoints (ok() and created() work without pagination parameter)
- Test OpenAPI schema generation includes pagination parameters correctly
- Verify pagination metadata calculations (totalPages, hasNext, hasPrevious)
- Test cursor pagination with missing/invalid cursors

## Reference Files

Key files to reference for implementation patterns:

- `apps/core/src/helpers/response.ts` - Response helper patterns and meta structure
- `apps/core/src/helpers/openapi.ts` - OpenAPI helper patterns
- `apps/core/src/routes/v1/jobs/get.ts` - Example route with query parameters
- `apps/core/src/routes/v1/agents/get.ts` - Example list endpoint
- `apps/core/src/schemas/job.schema.ts` - Schema definition patterns
- `apps/core/src/helpers/datetime.ts` - Helper utility patterns

## Notes

- The implementation should allow endpoints to choose between offset or cursor pagination (not both simultaneously)
- Endpoints can optionally support pagination (backward compatible)
- Consider performance implications: offset pagination doesn't scale well for large offsets, cursor pagination is more efficient
- Follow REST API best practices: use appropriate HTTP status codes, clear error messages
