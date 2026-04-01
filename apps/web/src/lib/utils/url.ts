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

export function buildAuthCallbackUrl(
  path: string,
  provider: SocialProviderId,
  returnUrl?: string,
): string {
  const params = new URLSearchParams({ provider });
  if (returnUrl) params.set("returnUrl", returnUrl);
  return `${path}?${params.toString()}`;
}

export function buildJobTransactionUrl(
  hash: string,
  isMainnet: boolean,
): string {
  return isMainnet
    ? siteConfig.links.jobTransactionMainnet.concat(hash)
    : siteConfig.links.jobTransactionPreprod.concat(hash);
}
