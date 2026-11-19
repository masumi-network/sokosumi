import { bareHost, squash } from "./text";

/** What goes on to the model that picks the real events. */
const MAX_CANDIDATES = 10;
const QUOTE_CHARS = 280;
const TITLE_CHARS = 160;

/**
 * Sites that write about a company without anything having happened: review
 * and comparison sites, job boards, social networks and forums.
 */
export const NEWS_JUNK_DOMAINS = [
  "g2.com",
  "capterra.com",
  "getapp.com",
  "softwareadvice.com",
  "trustpilot.com",
  "trustradius.com",
  "alternativeto.net",
  "saasworthy.com",
  "sourceforge.net",
  "slashdot.org",
  "glassdoor.com",
  "indeed.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "reddit.com",
  "quora.com",
  "wikipedia.org",
  "youtube.com",
] as const;

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "tiktok.com",
  "pinterest.com",
];

const LISTICLE =
  /\b(?:alternatives?|competitors?|vs\.?|versus|compared|comparison|coupons?|promo codes?|discount codes?)\b|\b(?:best|top)\s+(?:\d+\s+)?[\w\s-]{0,40}\b(?:tools|apps|software|platforms|brands|services|products)\b|^\d+\s+(?:best|top)\b/i;
const JOB_TITLE =
  /\b(?:is hiring|we(?:'|’)re hiring|now hiring|job openings?|careers? at|open roles?|join our team)\b/i;
const JOB_PATH =
  /\/(?:careers?|(?:remote-)?jobs?|join-us|open-positions|stellen)(?:\/|$)/i;
const HOW_TO =
  /^(?:how to|what is|what are)\b|^(?:does|do|is|can|why|should)\b[^?]*\?$|\b(?:guide|tutorial|step[- ]by[- ]step|explained)\b/i;

export interface NewsCandidate {
  title: string;
  url: string;
  publishedDate?: string;
  passages: string[];
}

export interface NewsItem {
  title: string;
  url: string;
  publisher: string;
  publishedAt: Date;
  /** The article's own words that name the competitor. */
  quote: string | null;
}

function host(url: URL): string {
  return bareHost(url.hostname);
}

export function onDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

const PROFILE_HOSTS = [
  "crunchbase.com",
  "exa.ai",
  "github.com",
  "producthunt.com",
];

/** A review, job, forum or social site: it writes about companies, it is not one's own. */
export function thirdPartyHost(hostname: string): boolean {
  return [...NEWS_JUNK_DOMAINS, ...SOCIAL_HOSTS].some((domain) =>
    onDomain(hostname, domain),
  );
}

/** A site that lists companies: news can be there, a company's homepage is not. */
export function profileHost(hostname: string): boolean {
  return PROFILE_HOSTS.some((domain) => onDomain(hostname, domain));
}

const MONTH_NAME =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
/** What a page prints before its first sentence: weekday, dates, times, a wire's tag. */
const DATELINE = new RegExp(
  [
    "^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+",
    "^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\s*",
    `^(?:${MONTH_NAME})\\.?\\s+\\d{1,2},?\\s+\\d{4},?\\s*`,
    "^\\d{1,2},\\s+\\d{4}\\s*",
    "^-?\\s*\\d{1,2}:\\d{2}(?:\\s?(?:[ap]m|et|utc))?,?\\s*",
    "^\\/[a-z ]+\\/\\s*--\\s*",
  ].join("|"),
  "i",
);

function withoutDateline(sentence: string): string {
  let text = sentence.trim();
  for (let pass = 0; pass < 8; pass += 1) {
    const stripped = text.replace(DATELINE, "").trim();
    if (stripped === text) break;
    text = stripped;
  }
  return text;
}

/**
 * The article's own sentence that names the company, without the page
 * furniture a passage starts with (bylines, dates, headings). The first
 * sentence of the passage when none names it.
 */
export function quoteSentence(
  passage: string,
  names: readonly string[],
): string | null {
  const sentences = passage
    // Emphasis marks of the page's markup are not its words.
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])|\s#+\s|\s\.\.\.\s/)
    .map((sentence) => withoutDateline(sentence.replace(/^[#\s|·-]+/, "")))
    .filter((sentence) => sentence.length >= 30 && /[a-z]/.test(sentence));
  const named = sentences.find((sentence) =>
    names.some((name) => squash(sentence).includes(name)),
  );
  const quote = named ?? sentences[0] ?? null;
  return quote ? quote.slice(0, QUOTE_CHARS) : null;
}

/** One address per article: no tracking parameters, fragment or "www". */
export function canonicalNewsUrl(raw: string): string | null {
  const url = URL.parse(raw);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:"))
    return null;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|gclid|ref$|source$|mc_)/i.test(key))
      url.searchParams.delete(key);
  }
  const query = url.searchParams.toString();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${host(url)}${path}${query ? `?${query}` : ""}`;
}

/**
 * The search results that can be news about this competitor from the last
 * week: dated, naming it, one per address and title. Review and comparison
 * pages, listicles, how-tos, social posts and job ads are left out; which of
 * the rest report a real event is `pickNews`'s call.
 */
export function competitorNews(
  competitor: { name: string; websiteUrl: string | null },
  candidates: readonly NewsCandidate[],
  window: { since: Date; now: Date },
): NewsItem[] {
  const name = squash(competitor.name);
  const ownHost = competitor.websiteUrl
    ? URL.parse(competitor.websiteUrl)
    : null;
  // "cal.com" for Cal.com, so a mention of "calendar" does not count.
  const names = [name, ownHost ? squash(host(ownHost)) : ""].filter(
    (value) => value.length >= 3,
  );
  const urls = new Set<string>();
  const titles = new Set<string>();
  const items: NewsItem[] = [];
  for (const candidate of candidates) {
    const canonical = canonicalNewsUrl(candidate.url);
    const url = canonical ? URL.parse(canonical) : null;
    if (!canonical || !url) continue;
    const hostname = host(url);
    if (thirdPartyHost(hostname)) continue;
    const title = candidate.title.replace(/\s+/g, " ").trim();
    if (
      !title ||
      LISTICLE.test(title) ||
      JOB_TITLE.test(title) ||
      HOW_TO.test(title)
    )
      continue;
    if (JOB_PATH.test(url.pathname)) continue;
    const publishedAt = candidate.publishedDate
      ? new Date(candidate.publishedDate)
      : null;
    if (
      !publishedAt ||
      Number.isNaN(publishedAt.getTime()) ||
      publishedAt < window.since ||
      publishedAt > window.now
    )
      continue;
    const own = ownHost !== null && onDomain(hostname, host(ownHost));
    const passage = candidate.passages.find((text) =>
      names.some((value) => squash(text).includes(value)),
    );
    const named =
      own || names.some((value) => squash(title).includes(value)) || passage;
    if (!named) continue;
    const titleKey = squash(title);
    if (urls.has(canonical) || titles.has(titleKey)) continue;
    urls.add(canonical);
    titles.add(titleKey);
    const quote = quoteSentence(passage ?? candidate.passages[0] ?? "", names);
    items.push({
      title: title.slice(0, TITLE_CHARS),
      url: canonical,
      publisher: hostname,
      publishedAt,
      quote: quote || null,
    });
    if (items.length >= MAX_CANDIDATES) break;
  }
  return items;
}
