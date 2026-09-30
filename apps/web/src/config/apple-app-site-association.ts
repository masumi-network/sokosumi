/**
 * Where Apple reads which apps this host vouches for.
 *
 * Named here because `proxy.ts` has to let it through with no session and no
 * redirect, and the route under `src/app/.well-known/` serves it.
 */
export const APPLE_APP_SITE_ASSOCIATION_PATH =
  "/.well-known/apple-app-site-association";

/**
 * The native Sokosumi app (`apps/apple`), as `<Team ID>.<bundle ID>`.
 *
 * `webcredentials` is the service type `ASWebAuthenticationSession` requires
 * for an HTTPS callback: the system refuses the session with "Using HTTPS
 * callbacks requires Associated Domains using the `webcredentials` service
 * type". It lets the app receive its OAuth redirect at
 * `/auth/apple/callback` on this host, which no other app can claim.
 */
export const APPLE_APP_SITE_ASSOCIATION = {
  webcredentials: { apps: ["GVWN7HXYJB.com.sokosumi.app"] },
};
