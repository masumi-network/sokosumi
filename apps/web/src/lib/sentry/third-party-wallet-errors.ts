import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Cardano browser wallets inject `cardano.bundle.js` and throw when their
 * messaging bridge is unavailable (SOKOSUMI-13 on `/chat`).
 */
export const thirdPartyWalletIgnoreErrors: RegExp[] = [
  /Cannot read properties of undefined \(reading 'REQUEST_ID'\)/,
  /Failed to connect to MetaMask/i,
];

function getStackFrameFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => typeof filename === "string");
}

export function isThirdPartyWalletError(
  message: string,
  event?: ErrorEvent,
): boolean {
  if (thirdPartyWalletIgnoreErrors.some((pattern) => pattern.test(message))) {
    return true;
  }

  if (!event) {
    return false;
  }

  return getStackFrameFilenames(event).some((filename) =>
    /cardano\.bundle\.js/i.test(filename),
  );
}
