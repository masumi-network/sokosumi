import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { dateTimeSchema } from "./datetime.js";

/**
 * Standardized API error response schema
 * Mirrors success response structure for consistency
 */
export const errorResponseSchema = z
  .object({
    /** Machine-readable error identifier */
    error: z.string().openapi({ example: "Unauthorized" }),

    /** Human-readable description of the error */
    message: z.string().openapi({ example: "Authentication required" }),

    /** Metadata about the request and response */
    meta: z.object({
      /** ISO timestamp when the error was generated */
      timestamp: dateTimeSchema,
      requestId: z
        .string()
        .openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
      path: z.string().openapi({ example: "/v1/agents" }),
      method: z.string().openapi({ example: "GET" }),
    }),
  })
  .openapi("ErrorResponse");

/**
 * Error response structure (for TypeScript types and onError handler)
 */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Helper to create HTTPException with options stored in cause
 */
function createHTTPException(
  status: ContentfulStatusCode,
  message: string,
): HTTPException {
  return new HTTPException(status, { message });
}

/**
 * 400 Bad Request
 * The server cannot process the request due to client error
 */
export const badRequest = (message: string = "Bad Request"): HTTPException => {
  return createHTTPException(400, message);
};

/**
 * 401 Unauthorized
 * Authentication is required and has failed or has not been provided
 */
export const unauthorized = (
  message: string = "Unauthorized",
): HTTPException => {
  return createHTTPException(401, message);
};

/**
 * 403 Forbidden
 * The client does not have access rights to the content
 */
export const forbidden = (message: string = "Forbidden"): HTTPException => {
  return createHTTPException(403, message);
};

/**
 * 404 Not Found
 * The server cannot find the requested resource
 */
export const notFound = (message: string = "Not Found"): HTTPException => {
  return createHTTPException(404, message);
};

/**
 * 409 Conflict
 * The request conflicts with the current state of the server
 */
export const conflict = (message: string = "Conflict"): HTTPException => {
  return createHTTPException(409, message);
};

/**
 * 422 Unprocessable Entity
 * The request was well-formed but was unable to be followed due to semantic errors
 */
export const unprocessableEntity = (
  message: string = "Unprocessable Entity",
): HTTPException => {
  return createHTTPException(422, message);
};

/**
 * 429 Too Many Requests
 * The user has sent too many requests in a given amount of time
 */
export const tooManyRequests = (
  message: string = "Too Many Requests",
): HTTPException => {
  return createHTTPException(429, message);
};

/**
 * 500 Internal Server Error
 * The server encountered an unexpected condition that prevented it from fulfilling the request
 */
export const internalServerError = (
  message: string = "Internal Server Error",
): HTTPException => {
  return createHTTPException(500, message);
};

/**
 * 503 Service Unavailable
 * The server is not ready to handle the request
 */
export const serviceUnavailable = (
  message: string = "Service Unavailable",
): HTTPException => {
  return createHTTPException(503, message);
};

/**
 * Helper for onError handler to get error name from status code
 */
export function getErrorName(status: ContentfulStatusCode): string {
  const errorNames: Record<number, string> = {
    400: "BadRequest",
    401: "Unauthorized",
    403: "Forbidden",
    404: "NotFound",
    409: "Conflict",
    422: "UnprocessableEntity",
    429: "TooManyRequests",
    500: "InternalServerError",
    503: "ServiceUnavailable",
  };
  return errorNames[status] || "Error";
}
