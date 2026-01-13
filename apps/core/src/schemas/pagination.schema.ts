import { z } from "@hono/zod-openapi";

/**
 * Query parameter schema for offset-based pagination
 * Uses page (1-indexed) and pageSize parameters
 */
export const offsetPaginationQuerySchema = z
  .object({
    page: z
      .coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .openapi({
        param: { name: "page", in: "query" },
        description: "Page number (1-indexed)",
        example: 1,
      }),
    pageSize: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .openapi({
        param: { name: "pageSize", in: "query" },
        description: "Number of items per page (max 100)",
        example: 20,
      }),
  })
  .openapi("OffsetPaginationQuery");

/**
 * Query parameter schema for cursor-based pagination
 * Uses cursor and limit parameters
 */
export const cursorPaginationQuerySchema = z
  .object({
    cursor: z
      .string()
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description: "Cursor for pagination (ID of the last item from previous page)",
        example: "cmi4gmksz000104l8wps8p7fp",
      }),
    limit: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .openapi({
        param: { name: "limit", in: "query" },
        description: "Number of items to return (max 100)",
        example: 20,
      }),
  })
  .openapi("CursorPaginationQuery");

/**
 * Response metadata schema for offset-based pagination
 */
export const offsetPaginationMetaSchema = z
  .object({
    page: z.number().int().min(1).openapi({ example: 2 }),
    pageSize: z.number().int().min(1).openapi({ example: 20 }),
    total: z.number().int().min(0).openapi({ example: 150 }),
    totalPages: z.number().int().min(0).openapi({ example: 8 }),
    hasNext: z.boolean().openapi({ example: true }),
    hasPrevious: z.boolean().openapi({ example: true }),
  })
  .openapi("OffsetPaginationMeta");

/**
 * Response metadata schema for cursor-based pagination
 */
export const cursorPaginationMetaSchema = z
  .object({
    cursor: z.string().nullable().openapi({ example: "abc123" }),
    limit: z.number().int().min(1).openapi({ example: 20 }),
    hasNext: z.boolean().openapi({ example: true }),
    nextCursor: z.string().nullable().openapi({ example: "xyz789" }),
  })
  .openapi("CursorPaginationMeta");

/**
 * Type exports for pagination metadata
 */
export type OffsetPaginationMeta = z.infer<typeof offsetPaginationMetaSchema>;
export type CursorPaginationMeta = z.infer<typeof cursorPaginationMetaSchema>;
export type PaginationMeta = OffsetPaginationMeta | CursorPaginationMeta;
