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
 * SSE/EventSource and aborted fetch streams surface as generic connection
 * closures when users navigate away (SOKOSUMI-D2 on `/tasks/:taskId`).
 */
export const transientStreamIgnoreErrors: RegExp[] = [
  /^Connection closed\.?$/i,
  /^(?:TypeError: )?Error in input stream$/i,
];

/**
 * Safari enforces a replaceState rate limit; Next.js App Router canonical URL
 * sync can hit it under rapid navigation (SOKOSUMI-PX on `/chat`).
 */
export const browserHistoryRateLimitIgnoreErrors: RegExp[] = [
  /Attempt to use history\.replaceState\(\) more than 100 times per 10 seconds/i,
];

export function isInAppBrowserEnvironmentError(message: string): boolean {
  return inAppBrowserIgnoreErrors.some((pattern) => pattern.test(message));
}

export function isTransientStreamClosureError(message: string): boolean {
  return transientStreamIgnoreErrors.some((pattern) => pattern.test(message));
}

export function isBrowserHistoryRateLimitError(message: string): boolean {
  return browserHistoryRateLimitIgnoreErrors.some((pattern) =>
    pattern.test(message),
  );
}
