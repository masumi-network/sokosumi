import { Context } from "hono";
import * as z from "zod";

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
      timestamp: z.iso.datetime(),
      // Room for future additions: pagination, requestId, version, etc.
      requestId: z.string(),
    }),
  });

/**
 * Generic TypeScript type for API success responses
 */
export type SuccessResponse<T> = {
  data: T;
  meta: {
    timestamp: string;
    requestId: string;
  };
};
export const ok = <T>(c: Context, data: T) => {
  return c.json<SuccessResponse<T>, 200>(
    {
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId ?? undefined,
      },
    },
    200,
  );
};

export const empty = (c: Context) => {
  return c.body(null, 204);
};

export const created = <T>(c: Context, data: T) => {
  return c.json<SuccessResponse<T>, 201>(
    {
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId ?? undefined,
      },
    },
    201,
  );
};
