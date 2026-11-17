import * as Sentry from "@sentry/node";

import { recordCoreError, recordCoreWarning } from "./evlog.js";
import { messageSafeErrorFields } from "./safe-error-fields.js";
import { getEnvSecrets, redactDeep } from "./secret-redaction.js";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}

export function getErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "";
}

function getErrorStatusCode(error: unknown): number | null | undefined {
  if (error === null || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }

  const statusCode = (error as { statusCode: unknown }).statusCode;
  if (statusCode === null) {
    return null;
  }
  if (typeof statusCode === "number") {
    return statusCode;
  }
  return undefined;
}

function getPrismaErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Network timeouts and dropped connections from outbound HTTP/fetch calls.
 * Shared by Resend, Coworker retrieval, and similar integrations.
 */
export function isTransientFetchError(error: unknown): boolean {
  const message = getErrorMessage(error);
  const name = getErrorName(error);
  const statusCode = getErrorStatusCode(error);

  return (
    /timeout of \d+ms exceeded/i.test(message) ||
    /timed out after \d+ms/i.test(message) ||
    /aborted due to timeout/i.test(message) ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    /socket hang up/i.test(message) ||
    /connection terminated unexpectedly/i.test(message) ||
    /\b(ECONNRESET|ECONNABORTED|ETIMEDOUT)\b/.test(message) ||
    // Resend wraps unresolved fetch as Result error, not a thrown transport error.
    (name === "application_error" && statusCode === null) ||
    /Unable to fetch data\. The request could not be resolved\./i.test(message)
  );
}

/**
 * Statuses that say "the far side is not answering", not "the far side
 * rejected this request".
 *
 * 408/502/503/504 are written by a reverse proxy or load balancer, and
 * Cloudflare adds its own 520-524 range for an origin it cannot reach. A
 * restarting Masumi payment node surfaces as a 521 carrying Cloudflare's HTML
 * page instead of the node's error envelope. None of them clears by changing
 * code here, and callers on a one-minute cron would otherwise page once a
 * minute for the whole outage. 429 is deliberately absent: sustained rate
 * limiting is a quota decision someone has to make, not a wait.
 *
 * Reaching this needs an error object carrying `statusCode`, which is the shape
 * `throwResendError` already uses (`clients/email.client.ts`).
 */
const TRANSIENT_UPSTREAM_STATUS_CODES = new Set([
  408, 502, 503, 504, 520, 521, 522, 523, 524,
]);

export function isTransientUpstreamHttpError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  if (typeof statusCode !== "number") {
    return false;
  }
  return TRANSIENT_UPSTREAM_STATUS_CODES.has(statusCode);
}

/**
 * Prisma driver/adapter failures that usually clear on the next cron tick after
 * a migration or connection pool recycle.
 */
export function isTransientPrismaError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  if (code === "P2034" || code === "P2028" || code === "P1017") {
    return true;
  }

  const message = getErrorMessage(error);
  const name = getErrorName(error);

  return (
    (name === "DriverAdapterError" && /cache lookup failed/i.test(message)) ||
    /unable to start a transaction in the given time/i.test(message) ||
    /connection terminated unexpectedly/i.test(message)
  );
}

/**
 * Schema drift between the deployed Prisma client and database — typically a
 * brief window when migrations run before the matching app build is live.
 */
export function isSchemaDriftPrismaError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  // P2021: table missing; P2022: column missing — both appear when migrate
  // deploy runs before the matching app release is fully promoted.
  if (code === "P2021" || code === "P2022") {
    return true;
  }

  const message = getErrorMessage(error);

  return (
    /does not exist in the current database/i.test(message) ||
    /not found in enum/i.test(message)
  );
}

export function shouldSuppressSentryForExternalError(error: unknown): boolean {
  return (
    isTransientFetchError(error) ||
    isTransientUpstreamHttpError(error) ||
    isTransientPrismaError(error) ||
    isSchemaDriftPrismaError(error)
  );
}

interface SuppressedErrorOptions {
  extra?: Record<string, unknown>;
  /** Fixed text for failures whose provider details may contain personal data. */
  message?: string;
  /**
   * What the log keeps of a suppressed error: `"cause"`, its text, only when
   * every call behind it carries ids, counts, dates and enum values alone;
   * otherwise `"safe-fields"` (the default), its name, known code and status.
   */
  errorDetail?: "cause" | "safe-fields";
}

function logSuppressedExternalError(
  label: string,
  error: unknown,
  { extra, message, errorDetail = "safe-fields" }: SuppressedErrorOptions,
): void {
  // Fail closed: the error's text reaches the log only when the caller says
  // its operation carries ids, counts, dates and enum values alone. A mail
  // body, a one-time link or a quoted Prisma argument is nothing redaction
  // can recognize. A fixed `message` marks private detail and wins.
  const cause = errorDetail === "cause" && !message ? error : undefined;
  // Same last line of defence Sentry's `beforeSend` applies, for the other
  // sink. Error text assembled from a far side's response body can carry our
  // own credential back to us, and `extra` routinely holds that text.
  const fields = {
    suppressedFailure: { label },
    ...(redactDeep(extra ?? {}, getEnvSecrets()) as Record<string, unknown>),
    ...(cause === undefined ? { failure: messageSafeErrorFields(error) } : {}),
  };
  const context = { operation: "external_service_failure" };

  // A call inside a request lands on its event, a cron's or `waitUntil`
  // work's on its own event.
  if (isSchemaDriftPrismaError(error)) {
    recordCoreError(
      context,
      {
        message: "Kept a database schema mismatch out of Sentry",
        why: "The database schema does not match this Core build, as happens while migrations deploy before the matching release",
        fix: "If it lasts beyond the deploy, check that the deployed Core release matches the applied migrations.",
        cause,
      },
      fields,
    );
    return;
  }

  recordCoreWarning(
    context,
    {
      message: "Kept a transient external failure out of Sentry",
      why: "The call failed in a way that usually clears on the next attempt: a timeout, a dropped connection, an upstream gateway error or a busy database",
      fix: "Nothing, unless it repeats: then check the service named by suppressedFailure.label.",
      cause,
    },
    fields,
  );
}

/**
 * Pass context once via `extra`. Optional `sentry` holds tags/level only.
 * `extra` feeds suppressed-log context and Sentry extras.
 */
export function captureExternalServiceError(
  error: unknown,
  options: {
    label: string;
    sentry?: Parameters<typeof Sentry.captureException>[1];
  } & SuppressedErrorOptions,
): void {
  // Classify the original failure, but keep its message, stack and cause out
  // of both sinks when the caller needs a privacy-safe report.
  const reportedError = options.message ? new Error(options.message) : error;
  if (shouldSuppressSentryForExternalError(error)) {
    logSuppressedExternalError(options.label, error, options);
    return;
  }

  if (!options.extra) {
    Sentry.captureException(reportedError, options.sentry);
    return;
  }

  Sentry.withScope((scope) => {
    scope.setExtras(options.extra!);
    Sentry.captureException(reportedError, options.sentry);
  });
}
