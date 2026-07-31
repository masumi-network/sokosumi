import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { isAPIError } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { captureExternalServiceError } from "@/lib/external-service-errors";

import {
  type ErrorResponse,
  getErrorName,
  shouldReportHttpException,
} from "./error.js";

const RESERVED_ERROR_BODY_KEYS = new Set(["error", "message", "meta", "kind"]);

function mergeHttpExceptionExtensions(
  extensions: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extensions) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(extensions).filter(
      ([key]) => !RESERVED_ERROR_BODY_KEYS.has(key),
    ),
  );
}

function resolveBetterAuthApiErrorMessage(error: {
  message: string;
  body?: { message?: unknown } | null;
}): string {
  if (error.message) {
    return error.message;
  }

  if (typeof error.body?.message === "string" && error.body.message) {
    return error.body.message;
  }

  return "Authentication failed";
}

function resolveBetterAuthApiErrorStatus(
  statusCode: number,
): ContentfulStatusCode {
  if (statusCode >= 400 && statusCode <= 599) {
    return statusCode as ContentfulStatusCode;
  }

  return 500;
}

/**
 * Centralized error handler for Hono app
 * Formats HTTPExceptions into consistent error responses
 * Logs parsing errors for debugging
 */
export function errorHandler<E extends { Variables: RequestIdVariables }>(
  error: Error,
  c: Context<E>,
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

    const status = 500;
    const errorResponse: ErrorResponse = {
      error: getErrorName(status),
      message: "An unexpected error occurred",
      meta,
    };

    Sentry.captureException(error, {
      level: "fatal",
      contexts: {
        validation: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      tags: { error_type: "unexpected_validation" },
    });

    return c.json(errorResponse, status);
  }

  if (error instanceof HTTPException) {
    const status = error.status;

    if (shouldReportHttpException(error)) {
      Sentry.captureException(error);
    }

    const cause =
      typeof error.cause === "object" && error.cause !== null
        ? (error.cause as {
            extensions?: Record<string, unknown>;
            kind?: string;
          })
        : undefined;

    const extensions = mergeHttpExceptionExtensions(cause?.extensions);
    const kind =
      typeof cause?.kind === "string"
        ? cause.kind
        : typeof extensions.kind === "string"
          ? extensions.kind
          : undefined;

    const errorResponse = {
      error: getErrorName(status),
      message: error.message,
      ...(kind ? { kind } : {}),
      ...extensions,
      meta,
    };

    return c.json(errorResponse, status);
  }

  // Better Auth throws plain APIError (not HTTPException). With
  // enableSessionForAPIKeys, invalid x-api-key on getSession bubbles here as
  // "Invalid API key." — map to the auth status instead of a fatal 500.
  if (isAPIError(error)) {
    const status = resolveBetterAuthApiErrorStatus(error.statusCode);
    const message = resolveBetterAuthApiErrorMessage(error);

    if (status >= 500) {
      console.error("Better Auth APIError (server):", {
        requestId: c.var.requestId,
        path: c.req.path,
        method: c.req.method,
        status,
        message,
      });
      captureExternalServiceError(error, {
        label: "better_auth_api_error",
        sentry: {
          level: "error",
          tags: { error_type: "better_auth_api_error" },
        },
      });
    }

    return c.json(
      {
        error: getErrorName(status),
        message,
        meta,
      },
      status,
    );
  }

  console.error("Unexpected error:", {
    requestId: c.var.requestId,
    path: c.req.path,
    method: c.req.method,
    error: error.message,
    stack: error.stack,
  });

  captureExternalServiceError(error, {
    label: "unhandled_route_error",
    sentry: {
      level: "fatal",
      tags: { error_type: "unexpected" },
    },
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
