import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  type CursorPaginationMeta,
  cursorPaginationMetaSchema,
} from "@/schemas/pagination.schema";

import { dateTimeSchema } from "./datetime.js";

/**
 * Standardized API success response schema
 * Provides consistent success structure across all API endpoints
 */
export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    /** The actual response data */
    data: dataSchema,

    /** Metadata about the response */
    meta: z.object({
      /** ISO timestamp when the response was generated */
      timestamp: dateTimeSchema,
      requestId: z
        .string()
        .openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
      /** Optional pagination metadata for list endpoints */
      pagination: cursorPaginationMetaSchema.optional(),
    }),
  });

/**
 * Generic TypeScript type for API success responses
 */
export type SuccessResponse<T> = z.infer<
  ReturnType<typeof successResponseSchema<z.ZodType<T>>>
>;

type SuccessResponseWithCustomPagination<
  T,
  P extends Record<string, unknown>,
> = {
  data: T;
  meta: {
    timestamp: string;
    requestId: string;
    pagination?: P;
  };
};

export const ok = <T, P extends Record<string, unknown> = CursorPaginationMeta>(
  c: Context,
  data: T,
  paginationMeta?: P,
) => {
  return c.json<SuccessResponseWithCustomPagination<T, P>, 200>(
    {
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId,
        ...(paginationMeta ? { pagination: paginationMeta } : {}),
      },
    },
    200,
  );
};

export const created = <
  T,
  P extends Record<string, unknown> = CursorPaginationMeta,
>(
  c: Context,
  data: T,
  paginationMeta?: P,
) => {
  return c.json<SuccessResponseWithCustomPagination<T, P>, 201>(
    {
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId,
        ...(paginationMeta ? { pagination: paginationMeta } : {}),
      },
    },
    201,
  );
};
