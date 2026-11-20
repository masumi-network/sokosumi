import { onDomain } from "./news";
import { bareHost, squash } from "./text";

/** Who a source is checked against: the competitor it writes about. */
export interface SourceOwner {
  name: string;
  websiteUrl: string | null;
}

/**
 * Newsrooms and press wires that report a launch, a round or a deal
 * themselves. Trackers, directories and blogs that retell it are not here:
 * what they say is never a big move on its own.
 */
const REPUTABLE_NEWS_DOMAINS = [
  "apnews.com",
  "axios.com",
  "bbc.co.uk",
  "bbc.com",
  "bloomberg.com",
  "businessinsider.com",
  "businesswire.com",
  "cnbc.com",
  "forbes.com",
  "fortune.com",
  "ft.com",
  "globenewswire.com",
  "handelsblatt.com",
  "nytimes.com",
  "prnewswire.com",
  "reuters.com",
  "techcrunch.com",
  "theguardian.com",
  "theinformation.com",
  "theverge.com",
  "venturebeat.com",
  "wired.com",
  "wsj.com",
] as const;

/** A page that lists what changed in a product: an update, never a launch. */
const CHANGELOG_PATH =
  /\/(?:changelog|release-notes|releases|whats-new|updates)(?:\/|$)/i;

function hostOf(url: string | null): string | null {
  const parsed = url ? URL.parse(url) : null;
  return parsed ? bareHost(parsed.hostname) : null;
}

/** The competitor's own site: its website's domain, or a domain named like it. */
export function isOwnSource(url: string | null, owner: SourceOwner): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const own = hostOf(owner.websiteUrl);
  if (own && onDomain(host, own)) return true;
  return host.split(".").at(-2) === squash(owner.name);
}

export function isReputableSource(url: string | null): boolean {
  const host = hostOf(url);
  return (
    host !== null &&
    REPUTABLE_NEWS_DOMAINS.some((domain) => onDomain(host, domain))
  );
}

export function isChangelog(url: string | null): boolean {
  const parsed = url ? URL.parse(url) : null;
  return parsed !== null && CHANGELOG_PATH.test(parsed.pathname);
}
