/**
 * In-app browsers (Instagram, Facebook, LinkedIn) and embedded WebViews expose
 * partial `window.webkit` bridges that throw when scripts probe
 * `window.webkit.messageHandlers` (SOKOSUMI-Q1 on `/tasks/:taskId`).
 */
export const inAppBrowserIgnoreErrors: RegExp[] = [
  /window\.webkit\.messageHandlers/,
  /evaluating 'window\.webkit\.messageHandlers'/,
];

/**
 * Incomplete RSC/Flight or SSE streams when the user navigates away
 * (SOKOSUMI-D2, SOKOSUMI-RG). Production React Flight close() throws
 * minified error #412. Sentry's UI decodes that to "Connection closed."
 * Dev builds throw "Connection closed." directly.
 */
export const transientStreamIgnoreErrors: RegExp[] = [
  /^Connection closed\.?$/i,
  /^Minified React error #412\b/i,
  /^(?:TypeError: )?Error in input stream$/i,
];

/**
 * Safari enforces a replaceState rate limit; Next.js App Router canonical URL
 * sync can hit it under rapid navigation (SOKOSUMI-PX on `/chat`).
 */
export const browserHistoryRateLimitIgnoreErrors: RegExp[] = [
  /Attempt to use history\.replaceState\(\) more than 100 times per 10 seconds/i,
];

/**
 * Brave iOS (WebKit) reader probes evaluate Firefox's `window.__firefox__.reader`
 * bridge. The object is absent, so the probe throws into the page global
 * handler (SOKOSUMI-S0, SOKOSUMI-RX, SOKOSUMI-RY, SOKOSUMI-RZ).
 */
export const firefoxReaderBridgeIgnoreErrors: RegExp[] = [
  /window\.__firefox__/,
  /Can't find variable: __firefox__/,
];

export function isInAppBrowserEnvironmentError(message: string): boolean {
  return inAppBrowserIgnoreErrors.some((pattern) => pattern.test(message));
}

export function isFirefoxReaderBridgeError(message: string): boolean {
  return firefoxReaderBridgeIgnoreErrors.some((pattern) =>
    pattern.test(message),
  );
}

export function isTransientStreamClosureError(message: string): boolean {
  return transientStreamIgnoreErrors.some((pattern) => pattern.test(message));
}

export function isBrowserHistoryRateLimitError(message: string): boolean {
  return browserHistoryRateLimitIgnoreErrors.some((pattern) =>
    pattern.test(message),
  );
}
