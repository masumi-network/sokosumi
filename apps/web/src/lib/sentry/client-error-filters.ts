import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Client-side Sentry filters for third-party marketing scripts and browser extensions.
 *
 * GTM loads tags such as the LinkedIn Insight pixel; ad blockers and privacy extensions
 * often block their network calls, producing unhandled rejections that are not app bugs.
 *
 * @see https://masumi.sentry.io/issues/SOKOSUMI-P2
 */

/** Script URLs whose errors should not be reported (stack frame match). */
export const sentryClientDenyUrls: Array<string | RegExp> = [
  // LinkedIn Insight Tag (loaded via GTM)
  /li\.lms-analytics/i,
  /px\.ads\.linkedin\.com/i,
  // Browser extensions that wrap fetch (e.g. ad blockers)
  /frame_ant/i,
  /extensions\//i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
];

/** Error messages that are benign third-party fetch noise. */
export const sentryClientIgnoreErrors: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/,
];

function getExceptionValues(event: ErrorEvent): string[] {
  const values: string[] = [];
  if (typeof event.message === "string") {
    values.push(event.message);
  }
  for (const entry of event.exception?.values ?? []) {
    if (entry.value) {
      values.push(entry.value);
    }
    if (entry.type && entry.value) {
      values.push(`${entry.type}: ${entry.value}`);
    }
  }
  return values;
}

function stackFrameUrls(event: ErrorEvent): string[] {
  const urls: string[] = [];
  for (const entry of event.exception?.values ?? []) {
    for (const frame of entry.stacktrace?.frames ?? []) {
      if (frame.filename) {
        urls.push(frame.filename);
      }
    }
  }
  return urls;
}

function matchesPattern(value: string, pattern: string | RegExp): boolean {
  return typeof pattern === "string"
    ? value.includes(pattern)
    : pattern.test(value);
}

/** Returns true when the event should be dropped before sending to Sentry. */
export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  for (const message of getExceptionValues(event)) {
    for (const pattern of sentryClientIgnoreErrors) {
      if (matchesPattern(message, pattern)) {
        return true;
      }
    }
  }

  const frameUrls = stackFrameUrls(event);
  if (frameUrls.length === 0) {
    return false;
  }

  return frameUrls.some((url) =>
    sentryClientDenyUrls.some((pattern) => matchesPattern(url, pattern)),
  );
}
