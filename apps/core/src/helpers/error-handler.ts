import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";

import { type ErrorResponse, getErrorName } from "./error.js";

/**
 * Centralized error handler for Hono app
 * Formats HTTPExceptions into consistent error responses
 * Logs parsing errors for debugging
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

  if (error instanceof z.ZodError) {
    console.error("Zod parsing error:", {
      requestId: c.var.requestId,
      path: c.req.path,
      method: c.req.method,
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });

    const status = 422;
    const firstIssue = error.issues[0];
    const errorMessage = firstIssue
      ? firstIssue.path.length > 0
        ? `Key: ${firstIssue.path.join(".")} - ${firstIssue.message}`
        : firstIssue.message
      : "Validation failed";
    const errorResponse: ErrorResponse = {
      error: getErrorName(status),
      message: errorMessage,
      meta,
    };

    Sentry.captureException(error, {
      contexts: {
        validation: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      level: "fatal",
      tags: { error_type: "validation" },
    });

    return c.json(errorResponse, status);
  }

  if (error instanceof HTTPException) {
    const status = error.status;

    if (status >= 500) {
      Sentry.captureException(error);
    }

    const errorResponse: ErrorResponse = {
      error: getErrorName(status),
      message: error.message,
      meta,
    };

    return c.json(errorResponse, status);
  }

  console.error("Unexpected error:", {
    requestId: c.var.requestId,
    path: c.req.path,
    method: c.req.method,
    error: error.message,
    stack: error.stack,
  });

  Sentry.captureException(error, {
    level: "fatal",
    tags: { error_type: "unexpected" },
  });

  return c.json(
    {
      error: "InternalServerError",
      message: "An unexpected error occurred",
      meta,
    },
    500,
  );
}
