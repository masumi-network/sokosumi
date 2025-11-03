import { Context } from "hono";
import * as z from "zod";

/**
 * Standardized API success response schema
 * Provides consistent success structure across all API endpoints
 */
export const successResponseSchema = z.object({
  /** The actual response data (can be any type) */
  data: z.any().optional(),

  /** Metadata about the response */
  meta: z.object({
    /** ISO timestamp when the response was generated */
    timestamp: z.iso.datetime(),
    // Room for future additions: pagination, requestId, version, etc.
  }),
});

/**
 * Generic TypeScript type for API success responses
 */
export type SuccessResponse<T> = z.infer<typeof successResponseSchema> & {
  data?: T;
  meta: {
    timestamp: string;
  };
};

export const ok = <T>(c: Context, data: T) =>
  c.json<SuccessResponse<T>>({
    data,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });

export const empty = <T>(c: Context) => {
  c.status(204);
  c.json<SuccessResponse<T>>({
    data: undefined,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};

export const created = <T>(c: Context, data: T) => {
  c.status(201);
  return c.json<SuccessResponse<T>>({
    data,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};
