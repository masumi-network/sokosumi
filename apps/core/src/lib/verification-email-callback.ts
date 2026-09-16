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
 * app itself. An absolute value is left alone: Better Auth's own
 * `originCheck` on `/verify-email` still validates it against
 * `trustedOrigins`.
 */
export function anchorVerificationCallbackToWebApp(
  verificationUrl: string,
  webAppBaseUrl: string,
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

  parsed.searchParams.set(
    "callbackURL",
    new URL(callbackUrl ?? "/", webAppBaseUrl).toString(),
  );
  return parsed.toString();
}
