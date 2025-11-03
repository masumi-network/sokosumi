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

/**
 * Standardized API error response schema
 * Provides consistent error structure across all API endpoints
 */
export const errorResponseSchema = z.object({
  /** Error type (e.g., "BadRequest", "NotFound", "ValidationError") */
  error: z.string(),

  /** Human-readable error message describing what went wrong */
  message: z.string(),

  /** Optional machine-readable error code (e.g., "INSUFFICIENT_BALANCE", "VALIDATION_ERROR") */
  code: z.string().optional(),

  /** Optional validation details array (typically for Zod validation errors) */
  details: z.array(z.unknown()).optional(),

  /** Metadata about the error response */
  meta: z.object({
    /** ISO timestamp when the error occurred */
    timestamp: z.iso.datetime(),

    /** Optional request ID for distributed tracing */
    requestId: z.string().optional(),

    /** Optional API endpoint path where the error occurred (for debugging) */
    path: z.string().optional(),
  }),
});

/**
 * TypeScript type for API error responses
 */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

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

/**
 * Error response options
 */
interface ErrorOptions {
  code?: string;
  details?: unknown[];
  requestId?: string;
  path?: string;
}

/**
 * Helper to create error response object
 */
function createErrorResponse(
  error: string,
  message: string,
  options: ErrorOptions = {},
): ErrorResponse {
  return {
    error,
    message,
    ...options,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: options.requestId,
      path: options.path,
    },
  };
}

/**
 * 400 Bad Request
 * The server cannot process the request due to client error
 */
export const badRequest = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(400);
  return c.json<ErrorResponse>(
    createErrorResponse("BadRequest", message, options),
  );
};

/**
 * 401 Unauthorized
 * Authentication is required and has failed or has not been provided
 */
export const unauthorized = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(401);
  return c.json<ErrorResponse>(
    createErrorResponse("Unauthorized", message, options),
  );
};

/**
 * 403 Forbidden
 * The client does not have access rights to the content
 */
export const forbidden = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(403);
  return c.json<ErrorResponse>(
    createErrorResponse("Forbidden", message, options),
  );
};

/**
 * 404 Not Found
 * The server cannot find the requested resource
 */
export const notFound = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(404);
  return c.json<ErrorResponse>(
    createErrorResponse("NotFound", message, options),
  );
};

/**
 * 409 Conflict
 * The request conflicts with the current state of the server
 */
export const conflict = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(409);
  return c.json<ErrorResponse>(
    createErrorResponse("Conflict", message, options),
  );
};

/**
 * 422 Unprocessable Entity
 * The request was well-formed but was unable to be followed due to semantic errors
 */
export const unprocessableEntity = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(422);
  return c.json<ErrorResponse>(
    createErrorResponse("UnprocessableEntity", message, options),
  );
};

/**
 * 429 Too Many Requests
 * The user has sent too many requests in a given amount of time
 */
export const tooManyRequests = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(429);
  return c.json<ErrorResponse>(
    createErrorResponse("TooManyRequests", message, options),
  );
};

/**
 * 500 Internal Server Error
 * The server encountered an unexpected condition that prevented it from fulfilling the request
 */
export const internalServerError = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(500);
  return c.json<ErrorResponse>(
    createErrorResponse("InternalServerError", message, options),
  );
};

/**
 * 503 Service Unavailable
 * The server is not ready to handle the request
 */
export const serviceUnavailable = (
  c: Context,
  message: string,
  options?: ErrorOptions,
) => {
  c.status(503);
  return c.json<ErrorResponse>(
    createErrorResponse("ServiceUnavailable", message, options),
  );
};
