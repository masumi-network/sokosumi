import * as Sentry from "@sentry/node";

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

export function getPrismaErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Postmark (and similar HTTP email providers) can time out or drop connections
 * during upstream outages. Invites and notifications are already fire-and-forget.
 */
export function isTransientPostmarkError(error: unknown): boolean {
  const message = getErrorMessage(error);

  return (
    /timeout of \d+ms exceeded/i.test(message) ||
    /socket hang up/i.test(message) ||
    /\b(ECONNRESET|ECONNABORTED|ETIMEDOUT)\b/.test(message)
  );
}

/**
 * Prisma driver/adapter failures that usually clear on the next cron tick after
 * a migration or connection pool recycle.
 */
export function isTransientPrismaError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  if (code === "P2034") {
    return true;
  }

  const message = getErrorMessage(error);
  const name = getErrorName(error);

  return name === "DriverAdapterError" && /cache lookup failed/i.test(message);
}

/**
 * Schema drift between the deployed Prisma client and database — typically a
 * brief window when migrations run before the matching app build is live.
 */
export function isSchemaDriftPrismaError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  if (code === "P2022") {
    return true;
  }

  return /does not exist in the current database/i.test(getErrorMessage(error));
}

export function shouldSuppressSentryForExternalError(error: unknown): boolean {
  return (
    isTransientPostmarkError(error) ||
    isTransientPrismaError(error) ||
    isSchemaDriftPrismaError(error)
  );
}

export function logSuppressedExternalError(
  label: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const level = isSchemaDriftPrismaError(error) ? "error" : "warn";
  const payload = {
    error: getErrorMessage(error),
    ...extra,
  };

  if (level === "error") {
    console.error(`[${label}] suppressed external failure`, payload);
    return;
  }

  console.warn(`[${label}] suppressed external failure`, payload);
}

export function captureExternalServiceError(
  error: unknown,
  options: {
    label: string;
    sentry?: Parameters<typeof Sentry.captureException>[1];
    extra?: Record<string, unknown>;
  },
): void {
  if (shouldSuppressSentryForExternalError(error)) {
    logSuppressedExternalError(options.label, error, options.extra);
    return;
  }

  Sentry.captureException(error, options.sentry);
}
