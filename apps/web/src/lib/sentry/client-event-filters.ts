import type { ErrorEvent } from "@sentry/core";

const ANALYTICS_HOSTS = [
  "plausible.io",
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "vitals.vercel-insights.com",
  "va.vercel-scripts.com",
] as const;

const BROWSER_EXTENSION_FRAME_PATTERNS = [
  /injectScriptAdjust\.js/i,
  /frame_ant\.js/i,
  /chrome-extension:/i,
  /moz-extension:/i,
  /safari-extension:/i,
] as const;

const ANALYTICS_SCRIPT_FRAME_PATTERNS = [
  /plausible\.io/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /gtag\/js/i,
] as const;

function collectExceptionText(event: ErrorEvent): string {
  const parts: string[] = [];

  if (event.message) {
    parts.push(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      parts.push(exception.value);
    }
    if (exception.type) {
      parts.push(exception.type);
    }
  }

  return parts.join("\n");
}

function collectStackFrameFilenames(event: ErrorEvent): string[] {
  const filenames: string[] = [];

  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) {
        filenames.push(frame.filename);
      }
    }
  }

  return filenames;
}

function isFailedToFetchError(text: string): boolean {
  return /failed to fetch/i.test(text);
}

function referencesAnalyticsHost(text: string): boolean {
  return ANALYTICS_HOSTS.some((host) => text.includes(host));
}

function hasBrowserExtensionFrame(filenames: string[]): boolean {
  return filenames.some((filename) =>
    BROWSER_EXTENSION_FRAME_PATTERNS.some((pattern) => pattern.test(filename)),
  );
}

function hasAnalyticsScriptFrame(filenames: string[]): boolean {
  return filenames.some((filename) =>
    ANALYTICS_SCRIPT_FRAME_PATTERNS.some((pattern) => pattern.test(filename)),
  );
}

function hasAppStackFrame(filenames: string[]): boolean {
  return filenames.some(
    (filename) =>
      filename.includes("/_next/") ||
      filename.includes("/src/") ||
      filename.includes("webpack-internal://"),
  );
}

export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  const exceptionText = collectExceptionText(event);
  const stackFrameFilenames = collectStackFrameFilenames(event);

  if (!isFailedToFetchError(exceptionText)) {
    return false;
  }

  const analyticsFetchFailure =
    referencesAnalyticsHost(exceptionText) ||
    hasAnalyticsScriptFrame(stackFrameFilenames);

  if (!analyticsFetchFailure) {
    return false;
  }

  if (hasBrowserExtensionFrame(stackFrameFilenames)) {
    return true;
  }

  // Analytics scripts can fail without extension frames when blocked by network filters.
  return !hasAppStackFrame(stackFrameFilenames);
}

export function filterClientSentryEvent<T extends ErrorEvent>(
  event: T,
): T | null {
  return shouldDropClientSentryEvent(event) ? null : event;
}
