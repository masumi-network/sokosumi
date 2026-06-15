import { siteConfig } from "@/config/site";
import type { SocialProviderId } from "@/lib/schemas";

export function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function getFileNameFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.split("/").pop() ?? null;
  } catch {
    return url.split("/").pop() ?? null;
  }
}

export function buildFaviconCandidates(rawUrl: string): string[] {
  try {
    const u = new URL(rawUrl);
    const base = `${u.protocol}//${u.hostname}`;
    const host = u.hostname;
    return [
      `${base}/favicon.ico`,
      `${base}/favicon.png`,
      `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`,
    ];
  } catch {
    return [];
  }
}

/**
 * Returns the current location (pathname + search) suitable for use as returnUrl
 * in sign-in redirects. Normalizes "/" to "/chat" so credential and social sign-in
 * behave consistently.
 */
export function getReturnUrlFromCurrentLocation(): string {
  const path =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/chat";
  return path === "/" || path === "" ? "/chat" : path;
}

/**
 * Builds a social-auth callback URL for `authClient.signIn.social`.
 *
 * The result is an **absolute** URL anchored to the current web origin. This
 * matters when the browser `authClient` targets the Core Better Auth instance
 * (a different origin, e.g. `api.preprod.sokosumi.com`): Better Auth resolves a
 * relative `callbackURL` against the auth-server origin, so a bare
 * `/auth/callback/signin` would both land on the Core domain and collide with
 * Core's own `/auth/callback/:provider` route — surfacing as `state_not_found`.
 * Anchoring to `window.location.origin` (already a trusted origin) sends the
 * user back to the web app after the OAuth callback completes. Falls back to a
 * relative path when `window` is unavailable (SSR).
 */
export function buildAuthCallbackUrl(
  path: string,
  provider: SocialProviderId,
  returnUrl?: string,
): string {
  const params = new URLSearchParams({ provider });
  if (returnUrl) params.set("returnUrl", returnUrl);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${path}?${params.toString()}`;
}

export function buildJobTransactionUrl(
  hash: string,
  isMainnet: boolean,
): string {
  return isMainnet
    ? siteConfig.links.jobTransactionMainnet.concat(hash)
    : siteConfig.links.jobTransactionPreprod.concat(hash);
}
