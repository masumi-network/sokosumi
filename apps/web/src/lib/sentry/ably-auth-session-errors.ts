/**
 * Ably Realtime token re-auth after session loss (SOKOSUMI-RT).
 * Expected when Ably re-auths without a session (expiry / cookie loss / logout).
 * Legacy authUrl XHR turned POST /api/ably/auth 401 into an unhandled rejection
 * with the first message. The second is the authCallback error we pass to Ably
 * after owning that fetch.
 */
export const ablyAuthSessionIgnoreErrors: RegExp[] = [
  /Error response received from server: 401 body was: \{"error":"Unauthorized"\}/,
  /Ably auth failed: session is gone/,
];

export function isAblyAuthSessionErrorMessage(message: string): boolean {
  return ablyAuthSessionIgnoreErrors.some((pattern) => pattern.test(message));
}
