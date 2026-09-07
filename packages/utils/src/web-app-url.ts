/**
 * The web app host a deployed environment is reached on.
 *
 * Every environment answers on two hosts: its canonical domain, and the
 * per-deployment URL Vercel mints for the deployment behind it. Both serve the
 * same app from the same database, so a reader who arrives on the deployment
 * URL is signed in and sees nothing wrong. What they cannot see is that the
 * browser scopes a push subscription to the origin that created it, so their
 * notifications now belong to a host whose name changes with the next deploy.
 *
 * One canonical answer per network, so a link Core writes and a redirect the
 * web app serves cannot disagree about where the app lives.
 */

type SokosumiNetwork = "Mainnet" | "Preprod";

const CANONICAL_WEB_APP_URLS: Record<SokosumiNetwork, string> = {
  Mainnet: "https://app.sokosumi.com",
  Preprod: "https://preprod.sokosumi.com",
};

/** The canonical origin the network's web app is reached on, no trailing slash. */
export function getCanonicalWebAppUrl(network: SokosumiNetwork): string {
  return CANONICAL_WEB_APP_URLS[network];
}

/** The canonical host, for comparing against an incoming request's `Host`. */
export function getCanonicalWebAppHost(network: SokosumiNetwork): string {
  return new URL(getCanonicalWebAppUrl(network)).host;
}
