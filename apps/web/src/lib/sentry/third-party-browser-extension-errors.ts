import type { ErrorEvent } from "@sentry/nextjs";

/**
 * React DevTools injects `hook.js` into the page. When the extension probes
 * fiber metadata it can throw `Cannot read properties of undefined (reading
 * 'id')` with no first-party frames (SOKOSUMI-NB on `/tasks` and
 * `/tasks/:taskId`).
 *
 * Urban VPN (and similar proxies) inject `chrome-extension://…/executors/<n>.js`
 * that wraps XHR/fetch. `@sentry/nextjs` nextjsClientStackFrameNormalizationIntegration
 * rewrites those frames to `app:///executors/<n>.js`, so `chrome-extension:`
 * alone misses them (SOKOSUMI-S5, SOKOSUMI-QX, SOKOSUMI-QY).
 */
const extensionOnlyStackFilenamePatterns: RegExp[] = [
  /hook\.js/i,
  /injected\.js/i,
  /\/executors\/\d+\.js/i,
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
];

function getStackFrameFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => typeof filename === "string");
}

export function isBrowserExtensionOnlyStackError(event: ErrorEvent): boolean {
  const filenames = getStackFrameFilenames(event);
  if (filenames.length === 0) {
    return false;
  }

  return filenames.every((filename) =>
    extensionOnlyStackFilenamePatterns.some((pattern) =>
      pattern.test(filename),
    ),
  );
}
