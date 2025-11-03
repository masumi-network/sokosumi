import { HTTPException } from "hono/http-exception";
import { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Error response structure (for TypeScript types and onError handler)
 */
export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: unknown[];
  meta: {
    timestamp: string;
    requestId?: string;
    path?: string;
  };
}

/**
 * Options for error responses
 */
export interface ErrorOptions {
  code?: string;
  details?: unknown[];
  requestId?: string;
  path?: string;
}

/**
 * Helper to create HTTPException with options stored in cause
 */
function createHTTPException(
  status: ContentfulStatusCode,
  message: string,
  options?: ErrorOptions,
): HTTPException {
  const exception = new HTTPException(status, { message });
  exception.cause = options;
  return exception;
}

/**
 * 400 Bad Request
 * The server cannot process the request due to client error
 */
export const badRequest = (message: string, options?: ErrorOptions): never => {
  throw createHTTPException(400, message, options);
};

/**
 * 401 Unauthorized
 * Authentication is required and has failed or has not been provided
 */
export const unauthorized = (
  message: string,
  options?: ErrorOptions,
): never => {
  throw createHTTPException(401, message, options);
};

/**
 * 403 Forbidden
 * The client does not have access rights to the content
 */
export const forbidden = (message: string, options?: ErrorOptions): never => {
  throw createHTTPException(403, message, options);
};

/**
 * 404 Not Found
 * The server cannot find the requested resource
 */
export const notFound = (message: string, options?: ErrorOptions): never => {
  throw createHTTPException(404, message, options);
};

/**
 * 409 Conflict
 * The request conflicts with the current state of the server
 */
export const conflict = (message: string, options?: ErrorOptions): never => {
  throw createHTTPException(409, message, options);
};

/**
 * 422 Unprocessable Entity
 * The request was well-formed but was unable to be followed due to semantic errors
 */
export const unprocessableEntity = (
  message: string,
  options?: ErrorOptions,
): never => {
  throw createHTTPException(422, message, options);
};

/**
 * 429 Too Many Requests
 * The user has sent too many requests in a given amount of time
 */
export const tooManyRequests = (
  message: string,
  options?: ErrorOptions,
): never => {
  throw createHTTPException(429, message, options);
};

/**
 * 500 Internal Server Error
 * The server encountered an unexpected condition that prevented it from fulfilling the request
 */
export const internalServerError = (
  message: string,
  options?: ErrorOptions,
): never => {
  throw createHTTPException(500, message, options);
};

/**
 * 503 Service Unavailable
 * The server is not ready to handle the request
 */
export const serviceUnavailable = (
  message: string,
  options?: ErrorOptions,
): never => {
  throw createHTTPException(503, message, options);
};

/**
 * Helper for onError handler to get error name from status code
 */
export function getErrorName(status: number): string {
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
