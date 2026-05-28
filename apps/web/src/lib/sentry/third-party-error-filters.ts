import type { ErrorEvent } from "@sentry/nextjs";

const APP_HOSTS = ["app.sokosumi.com", "api.sokosumi.com", "sokosumi.com"];

const ANALYTICS_HOST_PATTERNS = [
  /px\.ads\.linkedin\.com/,
  /plausible\.io/,
  /pagead2\.googlesyndication\.com/,
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /snap\.licdn\.com/,
  /web\.cmp\.usercentrics\.eu/,
];

const THIRD_PARTY_SCRIPT_PATTERNS = [
  /li\.lms-analytics/,
  /plausible/,
  /googletagmanager\.com/,
  /gtag\/js/,
  /frame_ant/,
  /web\.cmp\.usercentrics\.eu/,
];

function extractFailedFetchHost(message: string): string | null {
  const match = message.match(/Failed to fetch \(([^)]+)\)/);
  return match?.[1] ?? null;
}

function isAppHost(host: string): boolean {
  return APP_HOSTS.some(
    (appHost) => host === appHost || host.endsWith(`.${appHost}`),
  );
}

function stackHasThirdPartyScript(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames.some((frame) =>
    THIRD_PARTY_SCRIPT_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

export function isThirdPartyAnalyticsError(event: ErrorEvent): boolean {
  const value = event.exception?.values?.[0]?.value ?? "";

  if (
    value.includes("Failed to fetch dynamically imported module:") &&
    ANALYTICS_HOST_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    return true;
  }

  if (!value.includes("Failed to fetch")) {
    return false;
  }

  const host = extractFailedFetchHost(value);
  if (host) {
    if (isAppHost(host)) {
      return false;
    }

    if (ANALYTICS_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      return true;
    }
  }

  return stackHasThirdPartyScript(event);
}

export function filterThirdPartyAnalyticsErrors(
  event: ErrorEvent,
): ErrorEvent | null {
  return isThirdPartyAnalyticsError(event) ? null : event;
}
