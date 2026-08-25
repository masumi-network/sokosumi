import type { ErrorEvent } from "@sentry/nextjs";

import { thirdPartyWalletScriptFilenamePatterns } from "@/lib/sentry/third-party-wallet-errors";

/**
 * React DevTools injects `hook.js` into the page. When the extension probes
 * fiber metadata it can throw `Cannot read properties of undefined (reading
 * 'id')` with no first-party frames (SOKOSUMI-NB on `/tasks` and
 * `/tasks/:taskId`). Wallet extensions inject similarly named page scripts.
 */
const extensionOnlyStackFilenamePatterns: RegExp[] = [
  /hook\.js/i,
  ...thirdPartyWalletScriptFilenamePatterns,
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
