import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Plausible is loaded via GTM. When ad blockers or privacy extensions block
 * plausible.io, the vendor script rejects with "Failed to fetch (plausible.io)".
 * These are not actionable application errors.
 */
export const sentryClientIgnoreErrors: Array<string | RegExp> = [
  /Failed to fetch \(plausible\.io\)/i,
];

export const sentryClientDenyUrls: Array<string | RegExp> = [/plausible\.io/i];

export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  const message = getEventMessage(event);
  return message ? /Failed to fetch \(plausible\.io\)/i.test(message) : false;
}

function getEventMessage(event: ErrorEvent): string | undefined {
  const exception = event.exception?.values?.[0];
  if (!exception) {
    return event.message;
  }

  const type = exception.type ?? "";
  const value = exception.value ?? "";
  const combined = `${type}: ${value}`.trim();
  return combined || event.message;
}
