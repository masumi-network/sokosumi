import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";

import { type ErrorResponse, getErrorName } from "./error.js";

/**
 * Centralized error handler for Hono app
 * Formats HTTPExceptions into consistent error responses
 */
export function errorHandler(
  error: Error,
  c: Context<{ Variables: RequestIdVariables }>,
): Response {
  const meta = {
    timestamp: new Date().toISOString(),
    requestId: c.var.requestId,
    path: c.req.path,
    method: c.req.method,
  };

  if (error instanceof HTTPException) {
    const status = error.status;

    const errorResponse: ErrorResponse = {
      error: getErrorName(status),
      message: error.message,
      meta,
    };

    return c.json(errorResponse, status);
  }

  // Handle unexpected errors
  return c.json(
    {
      error: "InternalServerError",
      message: "An unexpected error occurred",
      meta,
    },
    500,
  );
}
