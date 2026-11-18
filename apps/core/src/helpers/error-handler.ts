import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { isAPIError } from "better-auth/api";
import { createError } from "evlog";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { tryUseLogger } from "@/lib/evlog";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

import {
  type ErrorResponse,
  getErrorName,
  type HTTPExceptionMetadata,
  shouldReportHttpException,
} from "./error.js";

const RESERVED_ERROR_BODY_KEYS = new Set(["error", "message", "meta", "kind"]);

function shouldMarkWideEventError(error: Error): boolean {
  if (error instanceof HTTPException) {
    return shouldReportHttpException(error);
  }

  if (isAPIError(error)) {
    return resolveBetterAuthApiErrorStatus(error.statusCode) >= 500;
  }

  return true;
}

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
 * The request's error, in Core's words. An unexpected error can quote
 * anything its route touched (a Prisma validation error quotes its call's
 * arguments, a provider error a mail or a prompt), so the event keeps only
 * its content-free fields, never its text; Sentry has the error itself.
 */
function recordRequestFailure(error: Error): void {
  const fields: Record<string, unknown> = {
    failure: messageSafeErrorFields(error),
  };
  if (error instanceof z.ZodError) {
    tryUseLogger()?.error(
      createError({
        message: "A response did not match its own schema",
        why: "The route built a response its OpenAPI schema rejects",
        fix: "Fix the route or its response schema; validation.issues names the fields that failed.",
      }),
      fields,
    );
    return;
  }
  if (error instanceof HTTPException) {
    const cause =
      typeof error.cause === "object" && error.cause !== null
        ? (error.cause as HTTPExceptionMetadata)
        : undefined;
    tryUseLogger()?.error(
      createError({
        message: "A request failed with a server error",
        why: "The route answered with an HTTP 5xx error",
        fix: "Sentry has the error; kind, when set, names the failure.",
      }),
      {
        ...fields,
        ...(typeof cause?.kind === "string" ? { kind: cause.kind } : {}),
      },
    );
    return;
  }
  if (isAPIError(error)) {
    tryUseLogger()?.error(
      createError({
        message: "Better Auth failed a request with a server error",
        why: "Better Auth raised an error with a 5xx status",
        fix: "Sentry has the error; betterAuth.message is Better Auth's own text.",
      }),
      fields,
    );
    return;
  }
  tryUseLogger()?.error(
    createError({
      message: "A request failed with an unexpected error",
      why: "The route threw an error it did not handle",
      fix: "Sentry has the error and its stack, unless it was a transient failure kept out of Sentry.",
    }),
    fields,
  );
}

/**
 * Centralized error handler for Hono app
 * Formats HTTPExceptions into consistent error responses
 * Logs parsing errors for debugging
 */
export const errorHandler: ErrorHandler = (error, c) => {
  const isAuthRedirect =
    c.req.path.startsWith("/auth/") &&
    isAPIError(error) &&
    error.statusCode >= 300 &&
    error.statusCode < 400;

  if (!isAuthRedirect && shouldMarkWideEventError(error)) {
    recordRequestFailure(error);
  }
  // evlog 2.28 captures `c.error` after `app.onError` and logs it whole, text
  // included. Expected 4xx and other handled client errors must stay info so
  // Sentry Logs do not treat them as failures, and a reported one is already
  // on the event above without its text.
  c.error = undefined;

  if (isAuthRedirect) {
    return new Response(null, {
      status: error.statusCode,
      headers: error.headers,
    });
  }

  const meta = {
    timestamp: new Date().toISOString(),
    requestId: c.var.requestId,
    path: c.req.path,
    method: c.req.method,
  };

  if (error instanceof z.ZodError) {
    // The wide event already carries the error; add which fields failed.
    tryUseLogger()?.set({
      validation: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
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
        ? (error.cause as HTTPExceptionMetadata)
        : undefined;

    const extensions = mergeHttpExceptionExtensions(cause?.extensions);
    const kind =
      typeof cause?.kind === "string"
        ? cause.kind
        : typeof extensions.kind === "string"
          ? extensions.kind
          : undefined;
    const retryAfterSeconds =
      typeof cause?.retryAfterSeconds === "number" &&
      cause.retryAfterSeconds >= 0
        ? Math.ceil(cause.retryAfterSeconds)
        : undefined;
    const isThrottled = retryAfterSeconds !== undefined;

    if (isThrottled) {
      tryUseLogger()?.set({
        rateLimit: { kind: kind ?? getErrorName(status), retryAfterSeconds },
      });
    }

    const errorResponse = {
      error: getErrorName(status),
      message: error.message,
      ...(kind ? { kind } : {}),
      ...(isThrottled ? { retryAfterSeconds } : {}),
      ...extensions,
      meta,
    };

    return c.json(errorResponse, status, {
      ...(isThrottled ? { "Retry-After": String(retryAfterSeconds) } : {}),
      ...(typeof cause?.wwwAuthenticate === "string"
        ? { "WWW-Authenticate": cause.wwwAuthenticate }
        : {}),
    });
  }

  // Better Auth throws plain APIError (not HTTPException). A rejected
  // credential bubbles here carrying its own status, so map that status
  // instead of reporting a fatal 500.
  if (isAPIError(error)) {
    const status = resolveBetterAuthApiErrorStatus(error.statusCode);
    const message = resolveBetterAuthApiErrorMessage(error);

    if (status >= 500) {
      tryUseLogger()?.set({ betterAuth: { status, message } });
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
};
