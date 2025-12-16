import { siteConfig } from "@/config/site";

export function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
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

export function buildJobTransactionUrl(
  hash: string,
  isMainnet: boolean,
): string {
  return isMainnet
    ? siteConfig.links.jobTransactionMainnet.concat(hash)
    : siteConfig.links.jobTransactionPreprod.concat(hash);
}
