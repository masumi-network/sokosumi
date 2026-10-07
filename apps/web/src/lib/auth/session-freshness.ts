/**
 * Better Auth rejects a sensitive route when the session is older than the
 * configured `freshAge`. Only signing in again clears it: freshness is measured
 * from `Session.createdAt` and no endpoint refreshes it.
 *
 * Gated routes in Better Auth 1.7.4: `/unlink-account`, `/list-sessions`, and
 * both halves of passkey registration, `/passkey/generate-register-options`
 * and `/passkey/verify-registration`. `/delete-user` is gated too, but only
 * when the request carries no password, which is how a viewer without one
 * deletes; it reports `SESSION_EXPIRED` rather than `SESSION_NOT_FRESH`, and
 * is the only route that throws that code. Credential changes are not gated
 * on freshness at all; they ask for the current password instead.
 *
 * Registration reads the clock twice, so a session that is fresh when the
 * ceremony starts can be stale when it ends. The authenticator then holds a
 * credential the server never stored, and the viewer is asked to
 * authenticate again. Nothing is corrupted, but the window is real.
 */
/** Better Auth's codes for a session too old for the route. */
const SESSION_NOT_FRESH_ERROR_CODES: ReadonlySet<unknown> = new Set([
  // `freshSessionMiddleware`
  "SESSION_NOT_FRESH",
  // `/delete-user` without a password
  "SESSION_EXPIRED",
]);

export function isSessionNotFreshError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return SESSION_NOT_FRESH_ERROR_CODES.has(error.code);
}
