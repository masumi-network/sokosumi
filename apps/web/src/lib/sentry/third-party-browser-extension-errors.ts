import type { ErrorEvent } from "@sentry/nextjs";

/**
 * React DevTools injects `hook.js` into the page. When the extension probes
 * fiber metadata it can throw `Cannot read properties of undefined (reading
 * 'id')` with no first-party frames (SOKOSUMI-NB on `/tasks` and
 * `/tasks/:taskId`).
 */
const extensionOnlyStackFilenamePatterns: RegExp[] = [
  /hook\.js/i,
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
