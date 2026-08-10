/**
 * Ably Realtime attach/detach lifecycle noise (SOKOSUMI-QK, QQ, QP, QS, KE,
 * QR). These surface as unhandled rejections or useChannel failures when
 * React unmounts, membership sync races, or the tab loses connectivity —
 * not application defects.
 */
export const ablyChannelLifecycleIgnoreErrors: RegExp[] = [
  /attach request superseded by a subsequent detach request/i,
  /detach request superseded by a subsequent attach request/i,
  /^channel detached\.?$/i,
  /channel detach timed out/i,
  /channel operation failed as channel state is failed/i,
  /connection to server unavailable/i,
];

export function isAblyChannelLifecycleErrorMessage(message: string): boolean {
  return ablyChannelLifecycleIgnoreErrors.some((pattern) =>
    pattern.test(message),
  );
}
