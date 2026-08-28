import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { dateTimeSchema } from "./datetime.js";

export interface HTTPExceptionMetadata {
  kind?: string;
  reportToSentry?: boolean;
  extensions?: Record<string, unknown>;
}

/**
 * Standardized API error response schema
 * Mirrors success response structure for consistency
 */
export const errorResponseSchema = z.object({
  /** Machine-readable error identifier */
  error: z.string().openapi({ example: "Unauthorized" }),

  /** Human-readable description of the error */
  message: z.string().openapi({ example: "Authentication required" }),

  /**
   * Optional stable machine-readable error kind (snake_case). Clients should
   * match on this instead of `message`, which may be reworded at any time.
   * Omitted when no kind has been assigned to the error.
   */
  kind: z.string().optional().openapi({ example: "organization_not_found" }),

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
});

/**
 * Error response structure (for TypeScript types and onError handler)
 */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Error envelope with extra top-level fields before `meta`.
 * Keeps `meta` last so enterprise (and other) extended error schemas stay consistent.
 */
export function errorResponseWithExtensionsSchema<T extends z.ZodRawShape>(
  extensions: T,
  openapiName?: string,
) {
  const schema = errorResponseSchema.omit({ meta: true }).extend({
    ...extensions,
    meta: errorResponseSchema.shape.meta,
  });

  return openapiName ? schema.openapi(openapiName) : schema;
}

/**
 * Helper to create HTTPException with options stored in cause
 */
function createHTTPException(
  status: ContentfulStatusCode,
  message: string,
  metadata?: HTTPExceptionMetadata,
): HTTPException {
  return new HTTPException(status, { message, cause: metadata });
}

/**
 * 400 Bad Request
 * The server cannot process the request due to client error
 */
export const badRequest = (
  message: string = "Bad Request",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(400, message, metadata);
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
export const forbidden = (
  message: string = "Forbidden",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(403, message, metadata);
};

/**
 * 404 Not Found
 * The server cannot find the requested resource
 */
export const notFound = (
  message: string = "Not Found",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(404, message, metadata);
};

/**
 * 409 Conflict
 * The request conflicts with the current state of the server
 */
export const conflict = (
  message: string = "Conflict",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(409, message, metadata);
};

/**
 * 413 Payload Too Large
 * The request entity is larger than limits defined by server
 */
export const payloadTooLarge = (
  message: string = "Payload Too Large",
): HTTPException => {
  return createHTTPException(413, message);
};

/**
 * 422 Unprocessable Entity
 * The request was well-formed but was unable to be followed due to semantic errors
 */
export const unprocessableEntity = (
  message: string = "Unprocessable Entity",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(422, message, metadata);
};

/**
 * 426 Upgrade Required
 * The client must reload or upgrade before retrying this operation.
 */
export const upgradeRequired = (
  message: string = "Upgrade Required",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(426, message, metadata);
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
 * 502 Bad Gateway
 * An upstream dependency (e.g. the payment node) failed or answered unusably
 */
export const badGateway = (
  message: string = "Bad Gateway",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(502, message, metadata);
};

/**
 * 503 Service Unavailable
 * The server is not ready to handle the request
 */
export const serviceUnavailable = (
  message: string = "Service Unavailable",
  metadata?: HTTPExceptionMetadata,
): HTTPException => {
  return createHTTPException(503, message, metadata);
};

export function shouldReportHttpException(error: HTTPException): boolean {
  if (error.status < 500) {
    return false;
  }

  const cause = error.cause;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "reportToSentry" in cause &&
    cause.reportToSentry === false
  ) {
    return false;
  }

  return true;
}

/**
 * Formats a ZodError into a user-friendly error message
 * Extracts the first validation issue and formats it with the field path if available
 *
 * @param error - The ZodError to format
 * @returns A formatted error message string
 */
export function formatZodErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return "Validation failed";
  }

  if (firstIssue.path.length > 0) {
    return `Key: ${firstIssue.path.join(".")} - ${firstIssue.message}`;
  }

  return firstIssue.message;
}

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
    413: "PayloadTooLarge",
    422: "UnprocessableEntity",
    426: "UpgradeRequired",
    429: "TooManyRequests",
    500: "InternalServerError",
    502: "BadGateway",
    503: "ServiceUnavailable",
  };
  return errorNames[status] || "Error";
}
