import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const THIRD_PARTY_FETCH_NOISE = [
  /^Failed to fetch \(plausible\.io\)$/i,
  /^Failed to fetch \(px\.ads\.linkedin\.com\)$/i,
] as const;

const BROWSER_EXTENSION_FRAME_PATTERNS = [
  /^app:\/\//i,
  /chrome-extension:/i,
  /moz-extension:/i,
  /frame_ant/i,
  /injectScriptAdjust/i,
] as const;

/** Patterns for denyUrls — block events whose stack originates in extensions. */
export const sentryBrowserExtensionDenyUrls: RegExp[] = [
  /^app:\/\//i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
];

/** Patterns for ignoreErrors — third-party fetch failures we do not initiate. */
export const sentryThirdPartyFetchIgnoreErrors: RegExp[] = [
  /^Failed to fetch \(plausible\.io\)$/i,
  /^Failed to fetch \(px\.ads\.linkedin\.com\)$/i,
];

function getExceptionMessage(event: ErrorEvent): string | undefined {
  return event.exception?.values?.[0]?.value ?? event.message ?? undefined;
}

function getStackFrameFilenames(event: ErrorEvent): string[] {
  const frames =
    event.exception?.values?.flatMap(
      (exception) => exception.stacktrace?.frames ?? [],
    ) ?? [];

  return frames
    .map((frame) => frame.filename ?? frame.abs_path ?? "")
    .filter((filename) => filename.length > 0);
}

export function shouldDropBrowserNoiseEvent(event: ErrorEvent): boolean {
  const message = getExceptionMessage(event);
  if (
    message &&
    THIRD_PARTY_FETCH_NOISE.some((pattern) => pattern.test(message))
  ) {
    return true;
  }

  const filenames = getStackFrameFilenames(event);
  if (filenames.length === 0) {
    return false;
  }

  return filenames.every((filename) =>
    BROWSER_EXTENSION_FRAME_PATTERNS.some((pattern) => pattern.test(filename)),
  );
}

export function beforeSendBrowserNoiseFilter(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  return shouldDropBrowserNoiseEvent(event) ? null : event;
}
