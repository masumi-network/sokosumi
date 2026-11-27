import { z } from "@hono/zod-openapi";

const count = z.number().int().nonnegative();
export const seoCrawlUrlSchema = z.string().min(1).max(4096);
const crawlUrl = seoCrawlUrlSchema;
const crawlText = z.string().max(2000);
/** The first pages of a check, as the SEO bot lists them, and the count of all. */
const pageList = z.object({ urls: z.array(crawlUrl).max(25), total: count });
const notDetermined = z.object({
  state: z.literal("not determined"),
  reason: crawlText,
});

/** Why the crawl stopped: the SEO bot's own values. */
export const seoCrawlStopSchema = z.enum([
  "complete",
  "page cap",
  "depth cap",
  "template cap",
  "link cap",
  "time",
  "rate limited",
  "robots.txt",
  "fetch failed",
]);

export const seoBadCanonicalKindSchema = z.enum([
  "target not 2xx",
  "other host",
  "conflicting",
  "changed in render",
  "removed in render",
  "unreadable",
]);

const crawled = z.object({
  state: z.literal("crawled"),
  /** URLs the crawl fetched. */
  fetched: count,
  /** HTML pages on the site whose links the crawl read. */
  read: count,
  stop: seoCrawlStopSchema,
  /** Null when the crawl read no HTML page. */
  links: z.union([
    z.object({
      broken: z
        .array(
          z.object({
            target: crawlUrl,
            status: count,
            /** Pages that link to the target. */
            linkedFrom: count,
            sources: z.array(crawlUrl).max(10),
            /** Each link is in a rendered page only, or the crawl cannot tell. */
            javascript: z.enum(["needed", "not determined"]).optional(),
          }),
        )
        .max(100),
      brokenTotal: count,
      chains: z
        .array(
          z.object({
            start: crawlUrl,
            kind: z.enum(["chain", "loop", "too many hops"]),
            hops: z.array(z.object({ url: crawlUrl, status: count })).max(11),
            final: z.union([crawlUrl, z.null()]),
            linkedFrom: count,
          }),
        )
        .max(100),
      chainsTotal: count,
      /** Links the crawl did not judge: their target was not read. */
      notJudged: count,
    }),
    z.null(),
  ]),
  /** Null in a report from before the crawl's JavaScript reads. */
  javascript: z.union([
    z.object({
      /** Shell pages whose links and text the crawl did not see. */
      unseen: count,
      groups: z
        .array(
          z.object({
            group: crawlText,
            state: z.enum([
              "needs javascript",
              "no difference",
              "sampled, one page",
              "not determined",
            ]),
            shellPages: count,
            reason: crawlText.optional(),
          }),
        )
        .max(50),
    }),
    z.null(),
  ]),
  /** Null when the crawl read no sitemap URL: the reason is in gaps. */
  orphans: z.union([
    z.discriminatedUnion("state", [
      z.object({
        state: z.literal("found"),
        urls: z.array(crawlUrl).max(100),
        total: count,
        /** A script may add a link to a listed page: not confirmed orphans. */
        candidates: z.boolean(),
      }),
      notDetermined,
    ]),
    z.null(),
  ]),
  /** Null when the crawl read no HTML page, or in a report from before these checks. */
  pageChecks: z.union([
    z.object({
      /** Pages the crawl read, and of them the pages in the title, h1 and duplicate checks. */
      pages: count,
      checked: count,
      missingTitle: pageList,
      missingH1: pageList,
      duplicateTitles: z.object({
        groups: z
          .array(
            z.object({
              text: crawlText,
              size: count,
              urls: z.array(crawlUrl).max(5),
            }),
          )
          .max(25),
        total: count,
        /** Pages whose duplicate check is not determined. */
        notDetermined: count,
      }),
      /** Null when the sitemap named no URL on the site. */
      noindexInSitemap: z.union([
        pageList.extend({
          /** Sitemap URLs, and of them those whose noindex the crawl could read. */
          sitemapUrls: count,
          checked: count,
        }),
        z.null(),
      ]),
      badCanonicals: z.object({
        pages: z
          .array(
            z.object({
              kind: seoBadCanonicalKindSchema,
              url: crawlUrl,
              canonical: z.union([crawlUrl, z.null()]),
              status: z.union([count, z.null()]),
            }),
          )
          .max(150),
        total: count,
        /** Canonicals whose target the crawl could not judge. */
        notDetermined: count,
      }),
    }),
    z.null(),
  ]),
  /** What the crawl could not see, in the SEO bot's words. */
  gaps: z.array(z.object({ item: crawlText, reason: crawlText })).max(50),
});

/** The site audit's crawl of the rest of the site, or why it has none. */
export const seoSiteCrawlSchema = z
  .discriminatedUnion("state", [
    crawled,
    z.object({ state: z.literal("not crawled"), reason: crawlText }),
  ])
  .openapi("ProjectSeoSiteCrawl");
export type SeoSiteCrawl = z.infer<typeof seoSiteCrawlSchema>;
