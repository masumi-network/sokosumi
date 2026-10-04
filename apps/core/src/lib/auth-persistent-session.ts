import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";

/**
 * `rememberMe: true` does not delete a stale `dont_remember` cookie.
 * Email-code, passkey, and OAuth then keep a session cookie, which iOS drops
 * with the home-screen app. Rewrite this session as persistent and expire
 * that cookie. The OAuth callback succeeds by throwing a redirect, so only an
 * error status counts as a failure. Impersonation stays session-only on
 * purpose.
 *
 * Not inside `/oauth2/authorize`. Once a sign-in sets the session cookie
 * during an OAuth request, the OAuth provider resumes that endpoint through
 * these same hooks, still carrying the new session; setting the cookie again
 * there makes the provider resume it again, without end. The sign-in has
 * already set it.
 */
export async function keepNewSessionPersistent(
  ctx: GenericEndpointContext & { context: { returned?: unknown } },
): Promise<void> {
  if (ctx.path === "/oauth2/authorize") {
    return;
  }
  const newSession = ctx.context.newSession;
  const returned = ctx.context.returned;
  if (
    newSession &&
    !newSession.session.impersonatedBy &&
    !(returned instanceof APIError && returned.statusCode >= 400)
  ) {
    await setSessionCookie(ctx, newSession, false);
    expireCookie(ctx, ctx.context.authCookies.dontRememberToken);
  }
}
