import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Domains used by marketing/analytics tags loaded via GTM or similar. */
const THIRD_PARTY_ANALYTICS_DOMAINS = [
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "plausible.io",
  "www.google-analytics.com",
  "www.googletagmanager.com",
  "region1.google-analytics.com",
] as const;

const FAILED_TO_FETCH_WITH_DOMAIN = /Failed to fetch \(([^)]+)\)/;

/** Script URLs or inline sources for third-party tags and browser extensions. */
const THIRD_PARTY_OR_EXTENSION_SCRIPT = [
  /li\.lms-analytics/i,
  /insight\.(?:old\.)?min\.js/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /plausible\.io/i,
  /usercentrics/i,
  /frame_ant/i,
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
];

const SENTRY_INSTRUMENTATION = /@sentry\/core/i;

function getPrimaryErrorMessage(event: ErrorEvent): string {
  const exception = event.exception?.values?.[0];
  return exception?.value ?? event.message ?? "";
}

function isThirdPartyAnalyticsDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return THIRD_PARTY_ANALYTICS_DOMAINS.some(
    (known) => normalized === known || normalized.endsWith(`.${known}`),
  );
}

function isThirdPartyAnalyticsFetchError(message: string): boolean {
  const match = FAILED_TO_FETCH_WITH_DOMAIN.exec(message);
  if (!match?.[1]) {
    return false;
  }
  return isThirdPartyAnalyticsDomain(match[1]);
}

function isThirdPartyOrExtensionScript(filename: string | undefined): boolean {
  if (!filename) {
    return false;
  }
  return THIRD_PARTY_OR_EXTENSION_SCRIPT.some((pattern) =>
    pattern.test(filename),
  );
}

function isSentryInstrumentationFrame(filename: string | undefined): boolean {
  if (!filename) {
    return false;
  }
  return SENTRY_INSTRUMENTATION.test(filename);
}

/**
 * Returns true when every meaningful stack frame originates from a third-party
 * script, browser extension, or Sentry fetch instrumentation — not app code.
 */
export function isThirdPartyOnlyStack(event: ErrorEvent): boolean {
  const frames =
    event.exception?.values?.[0]?.stacktrace?.frames?.filter(
      (frame) => frame.function || frame.filename,
    ) ?? [];

  if (frames.length === 0) {
    return false;
  }

  const relevantFrames = frames.filter(
    (frame) => !isSentryInstrumentationFrame(frame.filename),
  );

  if (relevantFrames.length === 0) {
    return false;
  }

  return relevantFrames.every((frame) =>
    isThirdPartyOrExtensionScript(frame.filename),
  );
}

/**
 * Drop client-side noise from marketing tags and extensions (e.g. ad blockers
 * blocking LinkedIn Insight or Plausible). Returns null to suppress the event.
 */
export function beforeSendClientEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  const message = getPrimaryErrorMessage(event);

  if (isThirdPartyAnalyticsFetchError(message)) {
    return null;
  }

  if (message.includes("Failed to fetch") && isThirdPartyOnlyStack(event)) {
    return null;
  }

  return event;
}
