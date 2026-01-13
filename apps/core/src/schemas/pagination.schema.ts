import { z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";

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
      .max(LIMITS.MAX_PAGINATION_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${LIMITS.MAX_PAGINATION_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  })
  .openapi("CursorPaginationQuery");

/**
 * Response metadata schema for cursor-based pagination
 */
export const cursorPaginationMetaSchema = z
  .object({
    cursor: z.string().nullable().openapi({
      example: "cmg4zknxt0000l404yn4li0kp",
      description: "Cursor for the current page",
    }),
    limit: z
      .number()
      .int()
      .min(1)
      .openapi({ example: 20, description: "Number of items returned" }),
    total: z
      .number()
      .int()
      .min(0)
      .openapi({ example: 100, description: "Total number of items" }),
    nextCursor: z.string().nullable().openapi({
      example: "cmi4gmksz000104l8wps8p7fp",
      description: "Cursor for the next page",
    }),
  })
  .openapi("PaginationMetadata");

export type CursorPaginationMeta = z.infer<typeof cursorPaginationMetaSchema>;

/** Alias for backward compatibility */
export type PaginationMeta = CursorPaginationMeta;
