import { z } from "@hono/zod-openapi";

import {
  type SeoKeywordReach,
  seoArticleIdeasSchema,
  seoFeatureReachSchema,
  seoRivalKeywordsSchema,
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
const rivalKeywords = z.array(
  z.object({
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
  }),
);
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
// The site's keyword rows as the SEO bot reads them for its topic words (related-topics.ts `siteRows`).
const pageRows = z.array(
  z.object({
    header: z
      .object({
        focusKeywords: z
          .array(z.object({ keyword: z.string(), volume: count.optional() }))
          .optional(),
      })
      .optional(),
    keywordOpportunities: z
      .object({
        list: z
          .array(z.object({ keyword: z.string(), volume: count.optional() }))
          .optional(),
      })
      .nullish(),
  }),
);

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
  const parsed = pageRows.safeParse(pages);
  if (!parsed.success) return [];
  const keywords = new Map<string, string>();
  for (const page of parsed.data)
    for (const row of [
      ...(page.header?.focusKeywords ?? []),
      ...(page.keywordOpportunities?.list ?? []),
    ]) {
      const key = row.keyword.toLowerCase().trim().replace(/\s+/g, " ");
      if (row.volume != null && !keywords.has(key))
        keywords.set(key, row.keyword);
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
  const rivals = rivalKeywords.safeParse(raw.rivalKeywords);
  const topic = rivals.success ? seoTopicWords(raw.pages) : [];
  // Each section is checked against its caps alone: one that does not fit drops that section only.
  const kept = {
    featureReach: seoFeatureReachSchema.safeParse(
      reach.success && reach.data.rows.length ? reach.data.rows : undefined,
    ),
    articleIdeas: seoArticleIdeasSchema.safeParse(
      ideas.success && ideas.data.ideas.length ? ideas.data.ideas : undefined,
    ),
    rivalKeywords: seoRivalKeywordsSchema.safeParse(
      rivals.success
        ? rivals.data.flatMap(({ host, total, rows }) =>
            rows?.length
              ? [
                  {
                    host,
                    total,
                    topicWords: topic,
                    rows: rows.map(({ url, ...row }) => {
                      const own = words(row.keyword);
                      return {
                        ...row,
                        url: url === null ? null : webAddress(url),
                        topic: topic.some((word) => own.has(word)),
                      };
                    }),
                  },
                ]
              : [],
          )
        : undefined,
    ),
  };
  return {
    ...(kept.featureReach.success && kept.featureReach.data
      ? { featureReach: kept.featureReach.data }
      : {}),
    ...(kept.articleIdeas.success && kept.articleIdeas.data
      ? { articleIdeas: kept.articleIdeas.data }
      : {}),
    ...(kept.rivalKeywords.success && kept.rivalKeywords.data?.length
      ? { rivalKeywords: kept.rivalKeywords.data }
      : {}),
  };
}
