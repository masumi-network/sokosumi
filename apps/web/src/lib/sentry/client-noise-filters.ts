import type { ErrorEvent } from "@sentry/nextjs";

const APP_HOSTS = new Set(["app.sokosumi.com", "sokosumi.com"]);

const THIRD_PARTY_FETCH_HOSTS = [
  "plausible.io",
  "pagead2.googlesyndication.com",
  "www.google.com",
  "googletagmanager.com",
  "google-analytics.com",
  "web.cmp.usercentrics.eu",
];

export const thirdPartyAnalyticsIgnoreErrors: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/,
  /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/,
  /^TypeError: Failed to fetch \(www\.google\.com\)$/,
  /^TypeError: Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//,
];

export const thirdPartyAnalyticsDenyUrls: Array<string | RegExp> = [
  /plausible\.io/i,
  /pagead2\.googlesyndication\.com/i,
  /web\.cmp\.usercentrics\.eu/i,
  /frame_ant/i,
  /injectScriptAdjust/i,
];

function getErrorMessage(event: ErrorEvent): string {
  const exception = event.exception?.values?.[0];
  if (!exception) {
    return event.message ?? "";
  }

  const type = exception.type ?? "Error";
  const value = exception.value ?? event.message ?? "";
  return value.startsWith(type) ? value : `${type}: ${value}`;
}

function getFailedFetchHost(message: string): string | null {
  const failedFetchMatch = message.match(
    /^TypeError: Failed to fetch \(([^)]+)\)$/,
  );
  if (failedFetchMatch) {
    return failedFetchMatch[1];
  }

  const dynamicImportMatch = message.match(
    /^TypeError: Failed to fetch dynamically imported module: https:\/\/([^/]+)\//,
  );
  if (dynamicImportMatch) {
    return dynamicImportMatch[1];
  }

  return null;
}

function isThirdPartyFetchHost(host: string): boolean {
  if (APP_HOSTS.has(host)) {
    return false;
  }

  return THIRD_PARTY_FETCH_HOSTS.some(
    (thirdPartyHost) =>
      host === thirdPartyHost || host.endsWith(`.${thirdPartyHost}`),
  );
}

export function isThirdPartyAnalyticsFetchFailure(event: ErrorEvent): boolean {
  const message = getErrorMessage(event);
  const failedFetchHost = getFailedFetchHost(message);
  if (failedFetchHost) {
    return isThirdPartyFetchHost(failedFetchHost);
  }

  return thirdPartyAnalyticsIgnoreErrors.some((pattern) => {
    if (typeof pattern === "string") {
      return message.includes(pattern);
    }

    return pattern.test(message);
  });
}

export function beforeSendClientEvent(event: ErrorEvent): ErrorEvent | null {
  if (isThirdPartyAnalyticsFetchFailure(event)) {
    return null;
  }

  return event;
}
