import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Marketing and analytics scripts loaded via GTM. These often throw unhandled
 * fetch rejections when blocked by ad blockers, privacy settings, or extensions.
 */
const THIRD_PARTY_FETCH_FAILURE_HOSTS = ["px.ads.linkedin.com"] as const;

const THIRD_PARTY_SCRIPT_URL_PATTERNS = [
  /\/li\.lms-analytics\//,
  /\/snap\.licdn\.com\//,
] as const;

export const thirdPartySentryIgnoreErrors: RegExp[] = [
  ...THIRD_PARTY_FETCH_FAILURE_HOSTS.map(
    (host) =>
      new RegExp(`Failed to fetch \\(${host.replaceAll(".", "\\.")}\\)`, "i"),
  ),
];

export const thirdPartySentryDenyUrls: RegExp[] = [
  ...THIRD_PARTY_SCRIPT_URL_PATTERNS,
];

function getEventMessages(event: ErrorEvent): string[] {
  const messages = new Set<string>();

  if (event.message) {
    messages.add(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      messages.add(exception.value);
    }
  }

  return [...messages];
}

function stackFramesOriginateFromThirdPartyScript(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.flatMap(
    (exception) => exception.stacktrace?.frames ?? [],
  );

  if (!frames?.length) {
    return false;
  }

  const inAppFrames = frames.filter((frame) => frame.in_app !== false);
  if (inAppFrames.length > 0) {
    return false;
  }

  return frames.some((frame) =>
    THIRD_PARTY_SCRIPT_URL_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

export function shouldDropThirdPartySentryEvent(
  event: ErrorEvent,
  _hint?: EventHint,
): boolean {
  const messages = getEventMessages(event);

  if (
    messages.some((message) =>
      thirdPartySentryIgnoreErrors.some((pattern) => pattern.test(message)),
    )
  ) {
    return true;
  }

  return stackFramesOriginateFromThirdPartyScript(event);
}
