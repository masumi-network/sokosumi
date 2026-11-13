import { domainToASCII } from "node:url";
import { seoClickRate } from "./keyword-clicks";

/** Weeks a share of voice keeps: the newest two years. */
export const SEO_SHARE_WEEKS = 104;
const DAY_MS = 86_400_000;

export interface SeoShareRead {
  keyword: string;
  device: string;
  countryCode: string;
  languageCode: string;
  observedAt: string;
  top: Array<{ rank: number; domain: string | null }>;
  suspect: boolean;
}

export interface SeoShareWeek {
  /** The Monday the week starts on, UTC. */
  weekStart: string;
  /** SERP reads counted: the newest of the week per keyword, device and Market. */
  reads: number;
  site: number;
  /** Every confirmed competitor, also one with no share. */
  competitors: Array<{ domain: string; share: number }>;
  /** Domains that are neither the site nor a confirmed competitor. */
  others: number;
  /** Results whose target the read could not name. */
  unattributed: number;
}

/**
 * A host as a SERP names it: lower case, "www." aside, an international name in its ASCII form. A page URL's host
 * is ASCII already; a SERP may name the Unicode form. A name that is no valid domain stays as it is.
 */
export function seoBareDomain(host: string): string {
  const lower = host.toLowerCase();
  return (domainToASCII(lower) || lower).replace(/^www\./, "");
}

function weekStart(at: string): string {
  const date = new Date(at);
  const day = Math.floor(date.getTime() / DAY_MS) * DAY_MS;
  // getUTCDay: 0 is Sunday. The week starts on Monday.
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(day - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Estimated share of organic clicks per week over the tracked keywords: each organic result of a read gets the
 * click-through rate of its rank (keyword-clicks.ts), and a share is a domain's clicks over all clicks of the
 * read results. Each keyword read counts the same, whatever its search volume. A rank the read does not hold
 * counts for no one, so shares are of the read results. A suspect read is left out.
 */
export function seoShareOfVoice(
  reads: SeoShareRead[],
  siteDomains: string[],
  competitorDomains: string[],
): SeoShareWeek[] {
  const site = new Set(siteDomains.map(seoBareDomain));
  const rivals = [
    ...new Set(
      competitorDomains.map(seoBareDomain).filter((d) => !site.has(d)),
    ),
  ];
  // The newest read of a week per keyword, device and Market.
  const weeks = new Map<string, Map<string, SeoShareRead>>();
  for (const read of reads) {
    if (read.suspect) continue;
    const week = weekStart(read.observedAt);
    const identity = JSON.stringify([
      read.keyword.normalize("NFKC").toLowerCase(),
      read.device,
      read.countryCode,
      read.languageCode,
    ]);
    const kept = weeks.get(week) ?? new Map<string, SeoShareRead>();
    const known = kept.get(identity);
    if (!known || known.observedAt < read.observedAt) kept.set(identity, read);
    weeks.set(week, kept);
  }
  const result: SeoShareWeek[] = [];
  for (const [week, kept] of weeks) {
    let total = 0,
      own = 0,
      others = 0,
      unattributed = 0;
    const byRival = new Map(rivals.map((domain) => [domain, 0]));
    for (const read of kept.values())
      for (const row of read.top) {
        const clicks = seoClickRate(row.rank);
        total += clicks;
        const domain = row.domain === null ? null : seoBareDomain(row.domain);
        if (domain === null) unattributed += clicks;
        else if (site.has(domain)) own += clicks;
        else if (byRival.has(domain))
          byRival.set(domain, (byRival.get(domain) ?? 0) + clicks);
        else others += clicks;
      }
    // A week whose reads hold no result on the first two pages gives no share.
    if (!total) continue;
    result.push({
      weekStart: week,
      reads: kept.size,
      site: own / total,
      competitors: rivals.map((domain) => ({
        domain,
        share: (byRival.get(domain) ?? 0) / total,
      })),
      others: others / total,
      unattributed: unattributed / total,
    });
  }
  return result
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-SEO_SHARE_WEEKS);
}
