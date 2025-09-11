import * as z from "zod";

/**
 * Standardized API error response schema
 * Provides consistent error structure across all API endpoints
 */
export const apiErrorResponseSchema = z.object({
  /** HTTP error name (e.g., "Bad Request", "Unauthorized", "Internal Server Error") */
  error: z.string(),

  /** Human-readable error message describing what went wrong */
  message: z.string(),

  /** Optional error code for machine-readable error handling (e.g., "INSUFFICIENT_BALANCE", "VALIDATION_ERROR") */
  code: z.string().optional(),

  /** Optional validation details array (typically for Zod validation errors) */
  details: z.array(z.unknown()).optional(),

  /** ISO timestamp when the error occurred */
  timestamp: z.iso.datetime(),

  /** Optional API endpoint path where the error occurred (for debugging) */
  path: z.string().optional(),

  /** Optional request ID for distributed tracing */
  requestId: z.string().optional(),
});

/**
 * TypeScript type for API error responses
 */
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * Helper function to create a standardized error response object
 *
 * @param error - HTTP error name
 * @param message - Human-readable error message
 * @param options - Optional additional error properties
 * @returns Standardized error response object
 */
export function createErrorResponse(
  error: string,
  message: string,
  options: {
    code?: string;
    details?: unknown[];
    path?: string;
    requestId?: string;
  } = {},
): ApiErrorResponse {
  return {
    error,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  };
}

/**
 * Common HTTP error names for consistent usage
 */
export const HttpErrors = {
  BAD_REQUEST: "Bad Request",
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not Found",
  METHOD_NOT_ALLOWED: "Method Not Allowed",
  CONFLICT: "Conflict",
  UNPROCESSABLE_ENTITY: "Unprocessable Entity",
  TOO_MANY_REQUESTS: "Too Many Requests",
  INTERNAL_SERVER_ERROR: "Internal Server Error",
  BAD_GATEWAY: "Bad Gateway",
  SERVICE_UNAVAILABLE: "Service Unavailable",
  GATEWAY_TIMEOUT: "Gateway Timeout",
} as const;
