import type { ErrorEvent } from "@sentry/nextjs";

import { getSentryErrorEventMessage } from "@/lib/sentry/error-event-message";

/**
 * Better Auth / FedCM rejections on iOS Chrome surface as minified unhandled
 * rejections with no stack (SOKOSUMI-PZ on `/auth/google` and `/agents`).
 */
export const minifiedOAuthIgnoreErrors: RegExp[] = [/^Aa$/];

const OAUTH_NOISE_TRANSACTION_PREFIXES = ["/auth/", "/agents"] as const;

function getStackFrameCount(event: ErrorEvent): number {
  return event.exception?.values?.[0]?.stacktrace?.frames?.length ?? 0;
}

function isOAuthNoiseTransaction(transaction: string): boolean {
  return OAUTH_NOISE_TRANSACTION_PREFIXES.some((prefix) =>
    transaction.startsWith(prefix),
  );
}

export function isMinifiedOAuthRejectionNoise(
  event: ErrorEvent,
  message: string,
): boolean {
  if (getStackFrameCount(event) > 0) {
    return false;
  }

  if (!minifiedOAuthIgnoreErrors.some((pattern) => pattern.test(message))) {
    return false;
  }

  const transaction =
    typeof event.transaction === "string"
      ? event.transaction
      : typeof event.tags?.transaction === "string"
        ? event.tags.transaction
        : "";

  return isOAuthNoiseTransaction(transaction);
}

export function isMinifiedOAuthRejectionNoiseMessage(
  event: ErrorEvent,
): boolean {
  return isMinifiedOAuthRejectionNoise(
    event,
    getSentryErrorEventMessage(event),
  );
}
