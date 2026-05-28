import type { ErrorEvent } from "@sentry/core";

const EXTENSION_SCRIPT_URL_PATTERN =
  /^(chrome|moz|safari|safari-web)-extension:\/\//i;

const EXTENSION_SCRIPT_FILENAME_PATTERN = /injectScriptAdjust\.js$/i;

const PLAUSIBLE_FETCH_FAILURE_PATTERN = /failed to fetch.*plausible\.io/i;

function getExceptionValues(event: ErrorEvent) {
  return event.exception?.values ?? [];
}

function getStackFrames(event: ErrorEvent) {
  return getExceptionValues(event).flatMap(
    (exception) => exception.stacktrace?.frames ?? [],
  );
}

function getErrorText(event: ErrorEvent): string {
  const parts: string[] = [];
  if (event.message) {
    parts.push(event.message);
  }
  for (const exception of getExceptionValues(event)) {
    if (exception.type) {
      parts.push(exception.type);
    }
    if (exception.value) {
      parts.push(exception.value);
    }
  }
  return parts.join(" ");
}

export function isBrowserExtensionStackFrame(
  filename: string | undefined,
): boolean {
  if (!filename) {
    return false;
  }

  if (EXTENSION_SCRIPT_URL_PATTERN.test(filename)) {
    return true;
  }

  return EXTENSION_SCRIPT_FILENAME_PATTERN.test(filename);
}

export function hasBrowserExtensionStackFrame(event: ErrorEvent): boolean {
  return getStackFrames(event).some((frame) =>
    isBrowserExtensionStackFrame(frame.filename ?? frame.abs_path),
  );
}

export function isPlausibleFetchFailure(event: ErrorEvent): boolean {
  return PLAUSIBLE_FETCH_FAILURE_PATTERN.test(getErrorText(event));
}

export function shouldDropClientSentryEvent(event: ErrorEvent): boolean {
  return hasBrowserExtensionStackFrame(event) || isPlausibleFetchFailure(event);
}

export const sentryClientDenyUrls: Array<string | RegExp> = [
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-extension:\/\//i,
  /^safari-web-extension:\/\//i,
];

export const sentryClientIgnoreErrors: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/i,
  /Failed to fetch \(plausible\.io\)/i,
];
