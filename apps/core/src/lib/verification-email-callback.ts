/**
 * Better Auth builds the verification link as
 * `${coreBaseURL}/verify-email?token=…&callbackURL=…`, where `callbackURL`
 * is whatever the client passed to `signUp.email` (or `/` when it passed
 * nothing). `/verify-email` redirects there after verifying, and a relative
 * value resolves against **Core's** origin, dropping the user on the API
 * host instead of the product.
 *
 * Credential sign-up deliberately sends no `callbackURL` — it would make
 * Better Auth hard-redirect the browser and kill the conversion events (see
 * apps/web/TRACKING.md) — so Core anchors the relative default to the web
 * app itself. An absolute same-origin value is left alone: Better Auth's
 * own `originCheck` on `/verify-email` still validates it against
 * `trustedOrigins`. Protocol-relative (`//host`) and other inputs that
 * resolve off the web origin are rewritten to the web app root — a leading
 * slash is not enough (`new URL("//evil", web)` is `https://evil/`).
 *
 * A sign-up that came through Core's OAuth provider for another app
 * (`oauthClientId`) lands on Web's confirmation page instead, which sends the
 * person back to that app rather than into Sokosumi.
 */
export function anchorVerificationCallbackToWebApp(
  verificationUrl: string,
  webAppBaseUrl: string,
  oauthClientId?: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(verificationUrl);
  } catch {
    return verificationUrl;
  }

  const callbackUrl = parsed.searchParams.get("callbackURL");
  if (callbackUrl && !callbackUrl.startsWith("/")) {
    return verificationUrl;
  }

  if (oauthClientId) {
    const confirmation = new URL("/auth/email-confirmed", webAppBaseUrl);
    confirmation.searchParams.set("client_id", oauthClientId);
    parsed.searchParams.set("callbackURL", confirmation.toString());
    return parsed.toString();
  }

  const webOrigin = new URL(webAppBaseUrl).origin;
  let destination: URL;
  try {
    destination = new URL(callbackUrl ?? "/", webAppBaseUrl);
  } catch {
    destination = new URL("/", webAppBaseUrl);
  }
  if (destination.origin !== webOrigin) {
    destination = new URL("/", webAppBaseUrl);
  }

  parsed.searchParams.set("callbackURL", destination.toString());
  return parsed.toString();
}
