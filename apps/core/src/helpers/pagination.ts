import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { dateTimeSchema } from "./datetime.js";

/**
 * Default page size for paginated responses
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Maximum page size for paginated responses
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Pagination query parameters schema
 * Supports offset-based pagination with page and limit
 */
export const paginationQuerySchema = z.object({
  page: z
    .coerce
    .number()
    .int()
    .positive()
    .default(1)
    .openapi({
      param: { name: "page", in: "query" },
      description: "Page number (1-indexed)",
      example: 1,
    }),
  limit: z
    .coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .openapi({
      param: { name: "limit", in: "query" },
      description: `Number of items per page (max ${MAX_PAGE_SIZE})`,
      example: DEFAULT_PAGE_SIZE,
    }),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Pagination metadata schema
 */
export const paginationMetaSchema = z.object({
  /** Current page number (1-indexed) */
  page: z.number().int().positive(),
  /** Number of items per page */
  limit: z.number().int().positive(),
  /** Total number of items across all pages */
  total: z.number().int().nonnegative(),
  /** Total number of pages */
  totalPages: z.number().int().nonnegative(),
  /** Whether there is a next page */
  hasNext: z.boolean(),
  /** Whether there is a previous page */
  hasPrev: z.boolean(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/**
 * Calculate pagination metadata from query parameters and total count
 */
export function calculatePaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Standardized paginated API success response schema
 * Extends the base success response schema with pagination metadata
 */
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T,
) =>
  z.object({
    /** The actual response data */
    data: dataSchema,
    /** Metadata about the response */
    meta: z.object({
      /** ISO timestamp when the response was generated */
      timestamp: dateTimeSchema,
      /** Request ID for tracking */
      requestId: z
        .string()
        .openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
      /** Pagination metadata */
      pagination: paginationMetaSchema,
    }),
  });

/**
 * Generic TypeScript type for paginated API success responses
 */
export type PaginatedResponse<T> = z.infer<
  ReturnType<typeof paginatedResponseSchema<z.ZodType<T>>>
>;

/**
 * Return a paginated success response
 */
export function okPaginated<T>(
  c: Context,
  data: T[],
  pagination: PaginationMeta,
) {
  return c.json<PaginatedResponse<T[]>, 200>(
    {
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId,
        pagination,
      },
    },
    200,
  );
}
