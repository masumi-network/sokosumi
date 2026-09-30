/**
 * The Better Auth generic OAuth provider id for Core. It names the callback
 * every CMO OAuth client registers: `<origin>/api/auth/callback/sokosumi`.
 */
export const SOKOSUMI_OAUTH_PROVIDER_ID = "sokosumi";

/**
 * What CMO sends to start Sign in with Sokosumi. "Create account" adds the
 * OpenID Connect `prompt=create`, which makes Core open Sokosumi's sign-up
 * page instead of its sign-in page.
 */
export function sokosumiSignInBody({
  createAccount,
}: {
  createAccount: boolean;
}) {
  return {
    provider: SOKOSUMI_OAUTH_PROVIDER_ID,
    callbackURL: "/",
    errorCallbackURL: "/",
    ...(createAccount ? { additionalParams: { prompt: "create" } } : {}),
  };
}
