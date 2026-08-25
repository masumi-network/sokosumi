import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Cardano / multi-chain browser wallets inject page scripts and throw when
 * their messaging bridge is unavailable (SOKOSUMI-13, SOKOSUMI-JB on `/chat`;
 * Begin Wallet `requestProvider.js` / `requestSolanaProvider.js` on `/`,
 * SOKOSUMI-RC / SOKOSUMI-RD).
 */
export const thirdPartyWalletIgnoreErrors: RegExp[] = [
  /Cannot read properties of undefined \(reading 'REQUEST_ID'\)/,
  /Cannot assign to read only property 'cardano'/,
  /Failed to connect to MetaMask/i,
];

/** Injected wallet script filenames as Sentry records them (`app:///…`). */
export const thirdPartyWalletScriptFilenamePatterns: RegExp[] = [
  /cardano\.bundle\.js/i,
  /injected\.js/i,
  /requestProvider\.js/i,
  /requestSolanaProvider\.js/i,
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
    thirdPartyWalletScriptFilenamePatterns.some((pattern) =>
      pattern.test(filename),
    ),
  );
}
