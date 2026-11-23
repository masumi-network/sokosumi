import { ssrfSafeFetch } from "@sokosumi/net";

const FETCH_TIMEOUT_MS = 6_000;
const MAX_TEXT_BYTES = 2_000_000;
/** Addresses read from a site's sitemaps; the pick needs a handful. */
const MAX_SITEMAP_URLS = 2_000;
/** A sitemap index lists more sitemaps; this many of them are opened. */
const MAX_SITEMAPS = 4;
/** The name robots.txt may address us by; rules for `*` apply too. */
const ROBOT_NAME = "sokosumibot";

async function readText(url: string): Promise<string | null> {
  try {
    const response = await ssrfSafeFetch(url, {
      headers: { "User-Agent": "SokosumiBot/1.0 (+https://sokosumi.com)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      maxResponseBytes: MAX_TEXT_BYTES,
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/** What a site's robots.txt asks of us. */
export interface SiteRobots {
  /** Whether a path may be read. */
  allows(pathname: string): boolean;
  /** The sitemaps it names. */
  sitemaps: string[];
}

/** A robots.txt path pattern as a test: `*` is any run, `$` ends the path. */
function pathRule(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\?\$$/, "$");
  return new RegExp(`^${escaped}`);
}

/**
 * Reads robots.txt: the group that names us, else the one for every robot.
 * The longest matching rule decides, and an allow wins a tie, as crawlers
 * read it. A missing or empty file allows everything.
 */
export function parseRobots(text: string): SiteRobots {
  const groups = new Map<string, { allow: boolean; rule: string }[]>();
  const sitemaps: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
    } else if (field === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      inRules = true;
      if (!value) continue;
      for (const agent of agents) {
        const rules = groups.get(agent) ?? [];
        rules.push({ allow: field === "allow", rule: value });
        groups.set(agent, rules);
      }
    }
  }
  const rules = (groups.get(ROBOT_NAME) ?? groups.get("*") ?? []).map(
    ({ allow, rule }) => ({ allow, length: rule.length, test: pathRule(rule) }),
  );
  return {
    sitemaps,
    allows(pathname) {
      let best: { allow: boolean; length: number } | null = null;
      for (const rule of rules) {
        if (!rule.test.test(pathname)) continue;
        if (
          !best ||
          rule.length > best.length ||
          (rule.length === best.length && rule.allow)
        )
          best = rule;
      }
      return best?.allow ?? true;
    },
  };
}

export async function readRobots(origin: string): Promise<SiteRobots> {
  return parseRobots(
    (await readText(new URL("/robots.txt", origin).href)) ?? "",
  );
}

/** The `<loc>` addresses of a sitemap or a sitemap index. */
export function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map(
    (match) => (match[1] as string).replace(/&amp;/g, "&"),
  );
}

/**
 * The pages a site lists in its sitemaps: those robots.txt names, else
 * /sitemap.xml. An index is followed one level down.
 */
export async function readSitemapPages(
  origin: string,
  robots: SiteRobots,
): Promise<string[]> {
  const queue = (
    robots.sitemaps.length > 0
      ? robots.sitemaps
      : [new URL("/sitemap.xml", origin).href]
  ).slice(0, MAX_SITEMAPS);
  const pages: string[] = [];
  let opened = 0;
  while (queue.length > 0 && opened < MAX_SITEMAPS) {
    const xml = await readText(queue.shift() as string);
    opened++;
    if (!xml) continue;
    const locations = sitemapLocations(xml);
    if (/<sitemapindex/i.test(xml)) queue.push(...locations);
    else pages.push(...locations);
    if (pages.length >= MAX_SITEMAP_URLS) break;
  }
  return pages.slice(0, MAX_SITEMAP_URLS);
}

/** Pages a site's documentation reads at most. */
export const MAX_DOCUMENTED_PAGES = 50;
/** Pages read below one top-level path (blog posts, docs), so one part cannot fill the rest. */
const MAX_PAGES_PER_PART = 5;
/** Paths with nothing for marketing: legal, sign-in, carts, feeds, archives. */
const SKIPPED_SEGMENT =
  /^(privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|tos|legal|imprint|impressum|datenschutz|agb|cookies?|cookie-policy|gdpr|dpa|disclaimer|login|log-in|signin|sign-in|signup|sign-up|register|logout|account|auth|password|reset-password|cart|checkout|basket|wp-admin|wp-json|wp-login\.php|admin|dashboard|feed|rss|tag|tags|category|categories|author|search|cdn-cgi|page)$/i;
const SKIPPED_FILE =
  /\.(pdf|jpe?g|png|gif|webp|svg|xml|json|txt|zip|mp4|mp3|webm|ics|csv)$/i;
/** A translated copy of the site under a language prefix: the original is read instead. */
const LANGUAGE_PREFIX =
  /^(de|fr|es|it|pt|nl|ja|zh|ko|ru|pl|sv|da|fi|nb|no|tr|ar|he|cs|hu|ro|uk|el|id|vi|th|en|en-[a-z]{2}|de-[a-z]{2}|fr-[a-z]{2}|es-[a-z]{2}|pt-[a-z]{2}|zh-[a-z]{2,4})$/i;

/** The address a page is known by: no query, no fragment, no trailing slash. */
export function pageAddress(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.origin}${path}`;
}

/**
 * The pages of a site worth documenting, home first: its own addresses only,
 * each once, without legal and sign-in pages, files, feeds or translated
 * copies; shallow pages before deep ones, in the order found (the site's
 * links before its sitemap), and at most a few below one top-level path.
 */
export function pickSitePages(
  websiteUrl: string,
  found: readonly string[],
  robots: Pick<SiteRobots, "allows"> = { allows: () => true },
  max: number = MAX_DOCUMENTED_PAGES,
): string[] {
  const site = new URL(websiteUrl);
  const host = (url: URL) => url.hostname.replace(/^www\./, "");
  const home = pageAddress(new URL("/", site));
  const seen = new Set<string>([home]);
  const candidates: { address: string; segments: string[] }[] = [];
  for (const raw of found) {
    const url = URL.parse(raw, site);
    if (!url || !/^https?:$/.test(url.protocol) || host(url) !== host(site))
      continue;
    const address = pageAddress(new URL(url.pathname, site.origin));
    if (seen.has(address)) continue;
    seen.add(address);
    const segments = new URL(address).pathname.split("/").filter(Boolean);
    if (
      segments.some((segment) => SKIPPED_SEGMENT.test(segment)) ||
      SKIPPED_FILE.test(address) ||
      LANGUAGE_PREFIX.test(segments[0] ?? "") ||
      !robots.allows(new URL(address).pathname)
    )
      continue;
    candidates.push({ address, segments });
  }
  const perPart = new Map<string, number>();
  const picked = [home];
  const ordered = candidates
    .map((candidate, order) => ({ ...candidate, order }))
    .sort((a, b) => a.segments.length - b.segments.length || a.order - b.order);
  for (const { address, segments } of ordered) {
    if (picked.length >= max) break;
    const part = segments.length > 1 ? (segments[0] as string) : "";
    const count = perPart.get(part) ?? 0;
    if (part && count >= MAX_PAGES_PER_PART) continue;
    perPart.set(part, count + 1);
    picked.push(address);
  }
  return picked;
}
