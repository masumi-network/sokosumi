import { z } from "@hono/zod-openapi";

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
        description:
          "Cursor for pagination (ID of the last item from previous page)",
        example: "cmi4gmksz000104l8wps8p7fp",
      }),
    limit: z.coerce
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
 * Response metadata schema for cursor-based pagination
 */
export const cursorPaginationMetaSchema = z
  .object({
    cursor: z.string().nullable().openapi({ example: "abc123" }),
    limit: z.number().int().min(1).openapi({ example: 20 }),
    total: z.number().int().min(0).openapi({ example: 100 }),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
  })
  .openapi("CursorPaginationMeta");

/**
 * Type exports for pagination metadata
 */
export type CursorPaginationMeta = z.infer<typeof cursorPaginationMetaSchema>;
export type PaginationMeta = CursorPaginationMeta;
