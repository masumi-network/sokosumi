import { z } from "@hono/zod-openapi";
import {
  type SeoSiteCrawl,
  seoBadCanonicalKindSchema,
  seoCrawlUrlSchema,
  seoSiteCrawlSchema,
} from "@/schemas/seo-site-crawl.schema";
import { reportObject as object } from "./project-seo-public-report";

/** The SEO bot's couldNotSee item when its Report has no crawl section, and the prefix of the crawl's own items. */
const CRAWL_ITEM = "Site crawl";
const CRAWL_PREFIX = "Site crawl: ";
/** The stored crawl's text and gap limits (seo-site-crawl.schema.ts). */
const MAX_TEXT = 2000;
const MAX_GAPS = 50;
/** The last stored gap when the crawl gave more than Sokosumi stores: a dropped gap may be about any check. */
const MORE_GAPS = "More gaps";

function capGaps<T extends { item: string; reason: string }>(gaps: T[]) {
  if (gaps.length <= MAX_GAPS) return gaps;
  const kept = gaps.slice(0, MAX_GAPS - 1);
  return [
    ...kept,
    {
      item: MORE_GAPS,
      reason: `the crawl gave ${gaps.length - kept.length} more gaps than Sokosumi stores, so no check can be clear`,
    },
  ];
}

const count = z.number().int();
/** A total of the bot, at least its own examples: a lower total would show a found check as clear. */
const atLeast = (total: number, examples: readonly unknown[]) =>
  Math.max(total, examples.length);
const page = z.object({ url: z.string() });
const pageList = <T extends z.ZodRawShape>(more: T) =>
  z
    .object({ pages: z.array(page.extend(more)), total: count })
    .transform((list) => ({ ...list, total: atLeast(list.total, list.pages) }));
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
    .transform((links) => ({
      ...links,
      brokenTotal: atLeast(links.brokenTotal, links.broken),
      chainsTotal: atLeast(links.chainsTotal, links.chains),
    }))
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
    .transform((orphans) =>
      orphans.state === "found"
        ? { ...orphans, total: atLeast(orphans.total, orphans.urls) }
        : orphans,
    )
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
      duplicateTitles: z
        .object({
          groups: z.array(
            z.object({ text: z.string(), size: count, pages: z.array(page) }),
          ),
          groupsTotal: count,
        })
        .transform((titles) => ({
          ...titles,
          groupsTotal: atLeast(titles.groupsTotal, titles.groups),
        })),
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

const gapEntry = z.object({ item: z.string(), reason: z.string() });

/**
 * A Report's gaps, read one by one. An entry Sokosumi cannot read may be about any check, so it stands as a gap
 * that leaves every check undecided.
 */
function readGaps(list: unknown, prefix: string) {
  if (list === undefined) return [];
  const rows: unknown[] = Array.isArray(list) ? list : [list];
  const read = rows.flatMap((row) => {
    const gap = gapEntry.safeParse(row);
    if (!gap.success) return [];
    // Storage cleanup first: a NUL inside the module prefix would hide the gap from its check.
    const item = storableText(gap.data.item);
    const reason = storableText(gap.data.reason);
    // A gap with no name, also after its module prefix, cannot be placed under any check.
    const name = item.startsWith(prefix) ? item.slice(prefix.length) : item;
    return /\S/.test(name) ? [{ item, reason }] : [];
  });
  const unreadable = rows.length - read.length;
  if (!unreadable) return read;
  return [
    ...read,
    {
      item: `${prefix}${MORE_GAPS}`,
      reason: `the Report holds ${unreadable} gap${unreadable === 1 ? "" : "s"} Sokosumi cannot read, so no check can be clear`,
    },
  ];
}
const urls = (list: { pages: { url: string }[]; total: number }) => ({
  urls: list.pages.map((p) => p.url).filter(storableUrl),
  total: list.total,
});

/** A bot text cut to what Sokosumi stores: one long gap must not drop the whole crawl. */
const cut = (text: string) =>
  text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT - 1).toWellFormed()}…`
    : text;
/** The gap item of the duplicate check, which Sokosumi words from the bot's count. */
const DUPLICATES_GAP = "Duplicate titles";

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
      list.pages.flatMap((p) => {
        const canonical = "canonical" in p ? p.canonical : null;
        return storableUrl(p.url) &&
          (canonical === null || storableUrl(canonical))
          ? [
              {
                kind,
                url: p.url,
                canonical,
                status: "status" in p ? p.status : null,
              },
            ]
          : [];
      }),
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
  const couldNotSee = readGaps(report?.couldNotSee, CRAWL_PREFIX);
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
          broken: links.broken.flatMap((link) =>
            storableUrl(link.target)
              ? [{ ...link, sources: link.sources.filter(storableUrl) }]
              : [],
          ),
          brokenTotal: links.brokenTotal,
          chains: links.chains.filter((chain) =>
            [
              chain.start,
              ...chain.hops.map((hop) => hop.url),
              ...(chain.final === null ? [] : [chain.final]),
            ].every(storableUrl),
          ),
          chainsTotal: links.chainsTotal,
          notJudged: links.notJudged ?? 0,
        }
      : null,
    javascript: javascript
      ? {
          unseen: javascript.unseen,
          groups: javascript.groups.map((group) => ({
            ...group,
            group: cut(group.group),
            ...(group.reason !== undefined && { reason: cut(group.reason) }),
          })),
        }
      : null,
    orphans:
      orphans?.state === "found"
        ? {
            state: "found",
            urls: orphans.urls.filter(storableUrl),
            total: orphans.total,
            candidates: orphans.candidates === true,
          }
        : orphans
          ? { state: orphans.state, reason: cut(orphans.reason) }
          : null,
    pageChecks: pageChecks
      ? {
          pages: pageChecks.pages,
          // Web counts the pages past `checked` as undecided: more checked than there are would cancel other undecided
          // pages, and a page whose head the bot could not read is in no check. Below zero would refuse the crawl.
          checked: Math.max(
            0,
            Math.min(
              pageChecks.checked,
              pageChecks.pages - (pageChecks.notDetermined ?? 0),
            ),
          ),
          missingTitle: urls(pageChecks.missingTitle),
          missingH1: urls(pageChecks.missingH1),
          duplicateTitles: {
            groups: pageChecks.duplicateTitles.groups.map((group) => ({
              text: cut(group.text),
              size: group.size,
              urls: group.pages.map((p) => p.url).filter(storableUrl),
            })),
            total: pageChecks.duplicateTitles.groupsTotal,
            notDetermined: pageChecks.duplicatesNotDetermined ?? 0,
          },
          noindexInSitemap: pageChecks.sitemap
            ? {
                ...urls(pageChecks.sitemap.noindex),
                sitemapUrls: pageChecks.sitemap.urls,
                checked: Math.min(
                  pageChecks.sitemap.checked,
                  pageChecks.sitemap.urls,
                ),
              }
            : null,
          badCanonicals: badCanonicals(
            pageChecks.canonicals,
            pageChecks.notDetermined ?? 0,
          ),
        }
      : null,
    gaps: capGaps([
      // The bot counts a page here when its title or its description is not compared, so the count is no
      // count of titles: it goes in words, not into the check's not-determined count.
      ...(pageChecks?.duplicatesNotCompared
        ? [
            {
              item: DUPLICATES_GAP,
              reason: `the check does not compare the title or the meta description of ${pageChecks.duplicatesNotCompared} page${pageChecks.duplicatesNotCompared === 1 ? "" : "s"}: the text holds too many combining marks in a row`,
            },
          ]
        : []),
      ...couldNotSee.flatMap((gap) =>
        gap.item.startsWith(CRAWL_PREFIX)
          ? [
              {
                item: cut(gap.item.slice(CRAWL_PREFIX.length)),
                reason: cut(gap.reason),
              },
            ]
          : [],
      ),
    ]),
  });
}

/** A text as PostgreSQL jsonb stores it: jsonb refuses NUL and a lone surrogate. */
export const storableText = (text: string) =>
  text.replaceAll("\u0000", "").toWellFormed();

/** A URL Sokosumi can store, also after storage cleanup. A list leaves out an example it cannot store, and keeps
 * its total: one long URL must not drop the whole crawl. */
export const storableUrl = (url: string) =>
  seoCrawlUrlSchema.safeParse(storableText(url)).success;

function parse(value: unknown) {
  // One character jsonb refuses would reject the whole import.
  const storable = JSON.parse(JSON.stringify(value), (_key, v) =>
    typeof v === "string" ? storableText(v) : v,
  );
  const result = seoSiteCrawlSchema.safeParse(storable);
  return result.success ? result.data : undefined;
}
