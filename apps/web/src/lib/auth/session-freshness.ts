/**
 * Better Auth rejects a sensitive route when the session is older than the
 * configured `freshAge`. Only signing in again clears it: freshness is measured
 * from `Session.createdAt` and no endpoint refreshes it.
 *
 * Gated routes in Better Auth 1.7.4: `/passkey/generate-register-options`,
 * `/unlink-account` and `/list-sessions`. Credential changes are not gated on
 * freshness; they ask for the current password instead.
 */
export const SESSION_NOT_FRESH_ERROR_CODE = "SESSION_NOT_FRESH";

export function isSessionNotFreshError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === SESSION_NOT_FRESH_ERROR_CODE;
}
