import type { ErrorEvent } from "@sentry/core";

/** Hostnames from GTM / marketing tags whose blocked fetch calls are not app bugs. */
const THIRD_PARTY_FETCH_HOST_PATTERNS: RegExp[] = [
  /^px\.ads\.linkedin\.com$/i,
  /^snap\.licdn\.com$/i,
  /^plausible\.io$/i,
  /^pagead2\.googlesyndication\.com$/i,
  /^www\.google-analytics\.com$/i,
  /^www\.googletagmanager\.com$/i,
  /^stats\.g\.doubleclick\.net$/i,
  /^web\.cmp\.usercentrics\.eu$/i,
];

const THIRD_PARTY_SCRIPT_URL_PATTERNS: RegExp[] = [
  /linkedin/i,
  /lms-analytics/i,
  /plausible/i,
  /googletagmanager/i,
  /google-analytics/i,
  /googlesyndication/i,
  /usercentrics/i,
  /frame_ant/i,
  /chrome-extension:/i,
];

const DYNAMIC_IMPORT_USERCENTRICS =
  /Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu/i;

function getExceptionMessage(event: ErrorEvent): string {
  const value = event.exception?.values?.[0]?.value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return typeof event.message === "string" ? event.message : "";
}

/** e.g. `TypeError: Failed to fetch (px.ads.linkedin.com)` → `px.ads.linkedin.com` */
export function getFailedFetchHost(message: string): string | null {
  const match = /^TypeError: Failed to fetch \(([^)]+)\)$/i.exec(
    message.trim(),
  );
  return match?.[1] ?? null;
}

export function isKnownThirdPartyFetchHost(host: string): boolean {
  return THIRD_PARTY_FETCH_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export function isThirdPartyAnalyticsFetchError(event: ErrorEvent): boolean {
  const message = getExceptionMessage(event);

  const fetchHost = getFailedFetchHost(message);
  if (fetchHost && isKnownThirdPartyFetchHost(fetchHost)) {
    return true;
  }

  if (DYNAMIC_IMPORT_USERCENTRICS.test(message)) {
    return true;
  }

  return hasOnlyThirdPartyScriptStack(event);
}

function hasOnlyThirdPartyScriptStack(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  const relevantFrames = frames.filter((frame) => {
    const filename = frame.filename ?? "";
    if (!filename) {
      return false;
    }
    if (filename.includes("node_modules/@sentry")) {
      return false;
    }
    return true;
  });

  if (relevantFrames.length === 0) {
    return false;
  }

  return relevantFrames.every((frame) =>
    THIRD_PARTY_SCRIPT_URL_PATTERNS.some((pattern) =>
      pattern.test(frame.filename ?? ""),
    ),
  );
}

export function shouldDropThirdPartyClientError(event: ErrorEvent): boolean {
  return isThirdPartyAnalyticsFetchError(event);
}

export const thirdPartyClientDenyUrls: RegExp[] = [
  /px\.ads\.linkedin\.com/i,
  /snap\.licdn\.com/i,
  /plausible\.io/i,
  /pagead2\.googlesyndication\.com/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /usercentrics\.eu/i,
  /frame_ant\.js/i,
  /chrome-extension:/i,
];

export const thirdPartyClientIgnoreErrors: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/i,
  /^TypeError: Failed to fetch \(plausible\.io\)$/i,
  /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/i,
  DYNAMIC_IMPORT_USERCENTRICS,
];
