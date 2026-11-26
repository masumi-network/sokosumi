import { z } from "@hono/zod-openapi";
import {
  type SeoSiteCrawl,
  seoBadCanonicalKindSchema,
  seoSiteCrawlSchema,
} from "@/schemas/seo-site-crawl.schema";
import { reportObject as object } from "./project-seo-public-report";

/** The SEO bot's couldNotSee item when its Report has no crawl section, and the prefix of the crawl's own items. */
const CRAWL_ITEM = "Site crawl";
const CRAWL_PREFIX = "Site crawl: ";
/** The stored crawl's text and gap limits (seo-site-crawl.schema.ts). */
const MAX_TEXT = 2000;
const MAX_GAPS = 50;

const count = z.number().int();
const page = z.object({ url: z.string() });
const pageList = <T extends z.ZodRawShape>(more: T) =>
  z.object({ pages: z.array(page.extend(more)), total: count });
const canonical = { canonical: z.string() };

/** The fields of the SEO bot's SiteReport crawl section that Sokosumi shows. */
const botCrawl = z.object({
  crawl: z.object({ fetched: count, read: count, stop: z.string() }),
  links: z
    .object({
      broken: z.array(
        z.object({
          target: z.string(),
          status: count,
          linkedFrom: count,
          sources: z.array(z.string()),
          javascript: z.string().optional(),
        }),
      ),
      brokenTotal: count,
      chains: z.array(
        z.object({
          start: z.string(),
          kind: z.string(),
          hops: z.array(z.object({ url: z.string(), status: count })),
          final: z.string().nullable(),
          linkedFrom: count,
        }),
      ),
      chainsTotal: count,
      notJudged: count.optional(),
    })
    .optional(),
  javascript: z
    .object({
      unseen: count,
      groups: z.array(
        z.object({
          group: z.string(),
          state: z.string(),
          shellPages: count,
          reason: z.string().optional(),
        }),
      ),
    })
    .optional(),
  orphans: z
    .discriminatedUnion("state", [
      z.object({
        state: z.literal("found"),
        urls: z.array(z.string()),
        total: count,
        candidates: z.literal(true).optional(),
      }),
      z.object({ state: z.literal("not determined"), reason: z.string() }),
    ])
    .optional(),
  pageChecks: z
    .object({
      pages: count,
      checked: count,
      /** Pages with no stored head: no check reads them. */
      notDetermined: count.optional(),
      missingTitle: pageList({}),
      missingH1: pageList({}),
      duplicatesNotDetermined: count.optional(),
      /** Pages whose title or meta description the bot does not compare. */
      duplicatesNotCompared: count.optional(),
      duplicateTitles: z.object({
        groups: z.array(
          z.object({ text: z.string(), size: count, pages: z.array(page) }),
        ),
        groupsTotal: count,
      }),
      sitemap: z
        .object({
          urls: count,
          checked: count,
          noindex: pageList({}),
        })
        .optional(),
      canonicals: z.object({
        targetNot2xx: pageList({ ...canonical, status: count }),
        otherHost: pageList(canonical),
        conflicting: pageList({}),
        changedInRender: pageList({}),
        removedInRender: pageList({}),
        unreadable: pageList({}),
        targetNotRead: pageList({}),
        unresolved: pageList({}),
        notClassified: count.optional(),
      }),
    })
    .optional(),
});
type BotCanonicals = z.infer<typeof botCrawl>["pageChecks"] & {};

const gapList = z.array(z.object({ item: z.string(), reason: z.string() }));
const urls = (list: { pages: { url: string }[]; total: number }) => ({
  urls: list.pages.map((p) => p.url),
  total: list.total,
});

/** A bot text cut to what Sokosumi stores: one long gap must not drop the whole crawl. */
const cut = (text: string) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;

/** noHead: pages whose canonical the bot never read. */
function badCanonicals(c: BotCanonicals["canonicals"], noHead: number) {
  const lists = {
    "target not 2xx": c.targetNot2xx,
    "other host": c.otherHost,
    conflicting: c.conflicting,
    "changed in render": c.changedInRender,
    "removed in render": c.removedInRender,
    unreadable: c.unreadable,
  } satisfies Record<z.infer<typeof seoBadCanonicalKindSchema>, unknown>;
  return {
    pages: Object.entries(lists).flatMap(([kind, list]) =>
      list.pages.map((p) => ({
        kind,
        url: p.url,
        canonical: "canonical" in p ? p.canonical : null,
        status: "status" in p ? p.status : null,
      })),
    ),
    total: Object.values(lists).reduce((sum, list) => sum + list.total, 0),
    notDetermined:
      noHead +
      c.targetNotRead.total +
      c.unresolved.total +
      (c.notClassified ?? 0),
  };
}

/**
 * The site crawl of an SEO bot SiteReport, in the shape Sokosumi stores.
 * Undefined when the owner asked for no crawl, for a Report from before the crawl, or when the section does not match:
 * the crawl is extra evidence, so a bad section never rejects the report.
 */
export function readSiteCrawl(raw: unknown): SeoSiteCrawl | undefined {
  const report = object(raw);
  const gaps = gapList.safeParse(report?.couldNotSee);
  const couldNotSee = gaps.success ? gaps.data : [];
  if (report?.crawl === undefined) {
    const missing = couldNotSee.find((gap) => gap.item === CRAWL_ITEM);
    if (!missing || object(report?.request)?.crawl === false) return undefined;
    return parse({ state: "not crawled", reason: cut(missing.reason) });
  }
  const section = botCrawl.safeParse(report.crawl);
  if (!section.success) return undefined;
  const { crawl, links, javascript, orphans, pageChecks } = section.data;
  return parse({
    state: "crawled",
    fetched: crawl.fetched,
    read: crawl.read,
    stop: crawl.stop,
    links: links
      ? {
          broken: links.broken,
          brokenTotal: links.brokenTotal,
          chains: links.chains,
          chainsTotal: links.chainsTotal,
          notJudged: links.notJudged ?? 0,
        }
      : null,
    javascript: javascript ?? null,
    orphans:
      orphans?.state === "found"
        ? {
            state: "found",
            urls: orphans.urls,
            total: orphans.total,
            candidates: orphans.candidates === true,
          }
        : (orphans ?? null),
    pageChecks: pageChecks
      ? {
          pages: pageChecks.pages,
          checked: pageChecks.checked,
          missingTitle: urls(pageChecks.missingTitle),
          missingH1: urls(pageChecks.missingH1),
          duplicateTitles: {
            groups: pageChecks.duplicateTitles.groups.map((group) => ({
              text: group.text,
              size: group.size,
              urls: group.pages.map((p) => p.url),
            })),
            total: pageChecks.duplicateTitles.groupsTotal,
            notDetermined:
              (pageChecks.duplicatesNotDetermined ?? 0) +
              (pageChecks.duplicatesNotCompared ?? 0),
          },
          noindexInSitemap: pageChecks.sitemap
            ? {
                ...urls(pageChecks.sitemap.noindex),
                sitemapUrls: pageChecks.sitemap.urls,
                checked: pageChecks.sitemap.checked,
              }
            : null,
          badCanonicals: badCanonicals(
            pageChecks.canonicals,
            pageChecks.notDetermined ?? 0,
          ),
        }
      : null,
    gaps: couldNotSee
      .flatMap((gap) =>
        gap.item.startsWith(CRAWL_PREFIX)
          ? [
              {
                item: cut(gap.item.slice(CRAWL_PREFIX.length)),
                reason: cut(gap.reason),
              },
            ]
          : [],
      )
      .slice(0, MAX_GAPS),
  });
}

function parse(value: unknown) {
  const result = seoSiteCrawlSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
