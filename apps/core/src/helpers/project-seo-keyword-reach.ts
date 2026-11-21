import { z } from "@hono/zod-openapi";

import {
  SEO_RIVAL_HOSTS_MAX,
  SEO_RIVAL_ROWS_MAX,
  SEO_STRATEGY_LABEL_MAX_LENGTH,
  SEO_TOPIC_WORDS_MAX,
  type SeoKeywordReach,
  seoArticleIdeasSchema,
  seoFeatureReachSchema,
  seoRivalHostSchema,
} from "@/schemas/project-seo-strategy.schema";

// The keyword reach sections of a site report (SEO bot ticket 76): the reach of each feature's best search, the
// keywords of the competing products, and article ideas. Core kept none of them before, so a section in a form Core
// cannot read is dropped, not the strategy or the audit.

const count = z.number().finite().nullable();
const featureReach = z.object({
  rows: z.array(
    z.object({
      feature: z.string(),
      keyword: z.string(),
      volume: z.number().finite(),
      demand: count,
      reach: z.string(),
      position: count,
      note: z.string().nullable(),
    }),
  ),
});
// Each host is read alone: a host Core cannot read is dropped, not the other hosts.
const rivalHost = z.object({
  host: z.string(),
  total: count,
  rows: z
    .array(
      z.object({
        keyword: z.string(),
        volume: count,
        position: count,
        url: z.string().nullable(),
      }),
    )
    .nullable(),
});
const articleIdeas = z.object({
  ideas: z.array(
    z.object({
      topic: z.string(),
      feature: z.string(),
      keyword: z.string().nullable(),
      demand: count,
      reach: z.string(),
      position: count,
      note: z.string().nullable(),
      suggestions: z
        .array(z.object({ keyword: z.string(), volume: z.number().finite() }))
        .nullable(),
    }),
  ),
});
// The site's keyword rows as the SEO bot reads them for its topic words (related-topics.ts `siteRows`). Each page and
// each row is read alone: a row Core cannot read does not count, and the other rows still give the topic words.
const sitePage = z.object({
  header: z
    .object({ focusKeywords: z.array(z.unknown()).optional() })
    .optional(),
  keywordOpportunities: z
    .object({ list: z.array(z.unknown()).optional() })
    .nullish(),
});
const siteRow = z.object({ keyword: z.string(), volume: count.optional() });

/** The share of the site's keyword rows a word must be in to be a topic word (SEO bot rival-keywords.ts). */
const TOPIC_SHARE = 0.5;
/** Fewer site keyword rows give no topic words. */
const MIN_TOPIC_ROWS = 5;
// Words that name no topic (the SEO bot's list). Not a full stop list: a word such as "app" can be a topic word.
const NO_TOPIC: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "my",
  "to",
  "from",
  "into",
  "on",
  "in",
  "at",
  "and",
  "or",
  "with",
  "how",
  "what",
  "why",
  "is",
  "vs",
  "best",
  "top",
  "free",
  "online",
  "der",
  "die",
  "das",
  "und",
  "für",
  "mit",
  "wie",
  "im",
  "zu",
  "von",
]);
/** Words of a keyword: NFC, lower case, apostrophes joined, cut at each character that is no letter, mark or digit. */
const words = (keyword: string) =>
  new Set(
    keyword
      .normalize("NFC")
      .toLowerCase()
      .replace(/['\u2019]/gu, "")
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter(Boolean),
  );

/**
 * The site's topic words, as the SEO bot's Report Markdown splits the competing products' keywords (bot B211): each
 * word in at least half of the site's keyword rows (5 or more rows, once per keyword), no filler, no number alone.
 */
export function seoTopicWords(pages: unknown): string[] {
  if (!Array.isArray(pages)) return [];
  const keywords = new Map<string, string>();
  for (const raw of pages) {
    const page = sitePage.safeParse(raw);
    if (!page.success) continue;
    for (const rawRow of [
      ...(page.data.header?.focusKeywords ?? []),
      ...(page.data.keywordOpportunities?.list ?? []),
    ]) {
      const row = siteRow.safeParse(rawRow);
      if (!row.success || row.data.volume == null) continue;
      // The SEO bot's normKeyword, without its cut of mark runs longer than 30 (a vendor keyword holds none).
      const key = row.data.keyword
        .normalize("NFC")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
      if (!keywords.has(key)) keywords.set(key, row.data.keyword);
    }
  }
  if (keywords.size < MIN_TOPIC_ROWS) return [];
  const counts = new Map<string, number>();
  for (const keyword of keywords.values())
    for (const word of words(keyword))
      if (!NO_TOPIC.has(word) && !/^\p{N}+$/u.test(word))
        counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n >= keywords.size * TOPIC_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
}

/** A competing product's rows with their topic marks; a host whose read failed or that Core cannot keep gives none. */
function rivalRows(
  raw: unknown,
  topic: string[],
  webAddress: (value: string) => string | null,
) {
  const host = rivalHost.safeParse(raw);
  if (!host.success || !host.data.rows?.length) return [];
  const kept = seoRivalHostSchema.safeParse({
    host: host.data.host,
    total: host.data.total,
    topicWords: topic,
    // The SEO bot sends the rows with most searches first; past the cap Core keeps those.
    rows: host.data.rows.slice(0, SEO_RIVAL_ROWS_MAX).map(({ url, ...row }) => {
      const own = words(row.keyword);
      return {
        ...row,
        url: url === null ? null : webAddress(url),
        topic: topic.some((word) => own.has(word)),
      };
    }),
  });
  return kept.success ? [kept.data] : [];
}

/**
 * The keyword reach sections of a site report that Core keeps with the strategy. A section without rows, and a host
 * whose read failed, give nothing. `webAddress` checks a competing page's link as the strategy targets are checked.
 */
export function publicSeoKeywordReach(
  raw: Record<string, unknown>,
  webAddress: (value: string) => string | null,
): SeoKeywordReach {
  const reach = featureReach.safeParse(raw.featureReach);
  const ideas = articleIdeas.safeParse(raw.articleIdeas);
  const hosts = Array.isArray(raw.rivalKeywords) ? raw.rivalKeywords : [];
  // Topic words come most rows first, so the cut keeps the strongest. A word longer than a stored label is not kept.
  const topic = hosts.length
    ? seoTopicWords(raw.pages)
        .filter((word) => word.length <= SEO_STRATEGY_LABEL_MAX_LENGTH)
        .slice(0, SEO_TOPIC_WORDS_MAX)
    : [];
  const rivalKeywords = hosts
    .flatMap((host) => rivalRows(host, topic, webAddress))
    .slice(0, SEO_RIVAL_HOSTS_MAX);
  // Each section is checked against its caps alone: one that does not fit drops that section only.
  const kept = {
    featureReach: seoFeatureReachSchema.safeParse(
      reach.success && reach.data.rows.length ? reach.data.rows : undefined,
    ),
    articleIdeas: seoArticleIdeasSchema.safeParse(
      ideas.success && ideas.data.ideas.length ? ideas.data.ideas : undefined,
    ),
  };
  return {
    ...(kept.featureReach.success && kept.featureReach.data
      ? { featureReach: kept.featureReach.data }
      : {}),
    ...(kept.articleIdeas.success && kept.articleIdeas.data
      ? { articleIdeas: kept.articleIdeas.data }
      : {}),
    ...(rivalKeywords.length ? { rivalKeywords } : {}),
  };
}
