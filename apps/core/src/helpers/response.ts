import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  type CursorPaginationMeta,
  cursorPaginationMetaSchema,
} from "@/schemas/pagination.schema";

import { dateTimeSchema } from "./datetime.js";
import { getErrorName } from "./error.js";

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

export const ok = <T>(
  c: Context,
  data: T,
  paginationMeta?: CursorPaginationMeta,
) => {
  return c.json<SuccessResponse<T>, 200>(
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

export const created = <T>(
  c: Context,
  data: T,
  paginationMeta?: CursorPaginationMeta,
) => {
  return c.json<SuccessResponse<T>, 201>(
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

export const empty = (c: Context) => {
  return c.body(null, 204);
};

/**
 * 422 with committed side-effect payload (e.g. OUT_OF_CREDITS pause event).
 * Does not throw — callers use this after the DB transaction has committed.
 */
export function unprocessableWithData<
  T,
  R extends string | null = string | null,
>(
  c: Context,
  data: T,
  options: {
    message: string;
    kind: string;
    attemptedCredits?: number;
    requestedStatus?: R;
  },
) {
  const { message, kind, attemptedCredits, requestedStatus } = options;
  return c.json(
    {
      error: getErrorName(422),
      message,
      kind,
      data,
      ...(attemptedCredits !== undefined ? { attemptedCredits } : {}),
      ...(requestedStatus !== undefined ? { requestedStatus } : {}),
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId,
        path: c.req.path,
        method: c.req.method,
      },
    },
    422,
  );
}
