import { Context } from "hono";
import * as z from "zod";

/**
 * Standardized API success response schema
 * Provides consistent success structure across all API endpoints
 */
export const successResponseSchema = z.object({
  /** Indicates successful operation (always true for success responses) */
  success: z.boolean().default(true),

  /** The actual response data (can be any type) */
  data: z.any().optional(),

  /** ISO timestamp when the response was generated */
  timestamp: z.iso.datetime(),
});

/**
 * Generic TypeScript type for API success responses
 */
export type SuccessResponse<T> = z.infer<typeof successResponseSchema> & {
  success: true;
  data?: T;
  timestamp: string;
};

export const ok = <T>(c: Context, data: T) =>
  c.json<SuccessResponse<T>>({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });

export const empty = <T>(c: Context) => {
  c.status(204);
  c.json<SuccessResponse<T>>({
    success: true,
    data: undefined,
    timestamp: new Date().toISOString(),
  });
};

export const created = <T>(c: Context, data: T) => {
  c.status(201);
  return c.json<SuccessResponse<T>>({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
};
