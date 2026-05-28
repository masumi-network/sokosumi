import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/** Domains whose blocked analytics/consent fetches are expected client-side noise. */
const THIRD_PARTY_FETCH_FAILURE_DOMAINS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "pagead2.googlesyndication.com",
  "www.google.com",
  "www.googletagmanager.com",
  "region1.google-analytics.com",
  "usercentrics.eu",
] as const;

const THIRD_PARTY_STACK_FRAME_MARKERS = [
  "plausible.io",
  "script.file-downloads",
  "frame_ant",
  "usercentrics.eu",
] as const;

function getPrimaryExceptionMessage(event: ErrorEvent): string {
  const primary = event.exception?.values?.[0];
  return primary?.value ?? event.message ?? "";
}

function hasThirdPartyStackFrame(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.some((frame) => {
    const filename = frame.filename ?? "";
    return THIRD_PARTY_STACK_FRAME_MARKERS.some((marker) =>
      filename.includes(marker),
    );
  });
}

function isThirdPartyFetchFailureMessage(message: string): boolean {
  if (!message.includes("Failed to fetch")) {
    return false;
  }

  if (message.includes("app.sokosumi.com")) {
    return false;
  }

  return THIRD_PARTY_FETCH_FAILURE_DOMAINS.some((domain) =>
    message.includes(domain),
  );
}

/** Drop unhandled rejections from third-party analytics/consent scripts. */
export function shouldDropThirdPartyFetchFailure(
  event: ErrorEvent,
  _hint?: EventHint,
): boolean {
  const message = getPrimaryExceptionMessage(event);
  return (
    isThirdPartyFetchFailureMessage(message) || hasThirdPartyStackFrame(event)
  );
}

export const thirdPartyFetchFailureIgnoreErrors: Array<string | RegExp> = [
  /^TypeError: Failed to fetch \(plausible\.io\)$/,
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/,
  /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/,
  /^TypeError: Failed to fetch \(www\.google\.com\)$/,
  /^TypeError: Failed to fetch dynamically imported module: https:\/\/web\.cmp\.usercentrics\.eu\//,
];
