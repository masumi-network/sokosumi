/**
 * The Better Auth generic OAuth provider id for Core. It names the callback
 * every CMO OAuth client registers: `<origin>/api/auth/callback/sokosumi`.
 */
export const SOKOSUMI_OAUTH_PROVIDER_ID = "sokosumi";

/**
 * Set by an explicit sign-out and cleared by the next sign-in that completes.
 * Signing out of CMO does not sign out of Sokosumi (ADR 0045), so while it is
 * set, Sign in asks Sokosumi for an account instead of landing in the same
 * one.
 */
export const SIGNED_OUT_COOKIE = "cmo.signed_out";

/**
 * What CMO sends to start Sign in with Sokosumi. "Create account" adds the
 * OpenID Connect `prompt=create`, which makes Core open Sokosumi's sign-up
 * page instead of its sign-in page. `signInAgain` adds `prompt=login`, so
 * Sokosumi asks for an account even when it is still signed in.
 */
export function sokosumiSignInBody({
  createAccount,
  signInAgain = false,
}: {
  createAccount: boolean;
  signInAgain?: boolean;
}) {
  const prompt = createAccount ? "create" : signInAgain ? "login" : undefined;
  return {
    provider: SOKOSUMI_OAUTH_PROVIDER_ID,
    callbackURL: "/",
    errorCallbackURL: "/",
    ...(prompt ? { additionalParams: { prompt } } : {}),
  };
}
