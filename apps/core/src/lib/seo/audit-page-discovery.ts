import { z } from "@hono/zod-openapi";
import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";
import { SEO_SEARCH_QUERY_ROW_LIMIT } from "@/schemas/project-seo-traffic.schema";
import { seoUrlSchema } from "@/schemas/seo-page.schema";
import {
  MAX_DISCOVERED_PAGES,
  MAX_TOP_CLICKED_PAGES,
  type SeoPageDiscovery,
} from "@/schemas/seo-page-discovery.schema";
import { gscPropertyCovers } from "./native-gsc-property";
import { gscNumberSchema, normalizeGscQueries } from "./native-gsc-queries";
import {
  gscReportArguments,
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
  previousSeoPeriod,
  readGscPropertyTotals,
  SEO_STATS_MAX_ROWS,
  unwrapNativeStatistics,
  withinSearchConsoleRetention,
} from "./native-statistics";
import {
  SEO_OPPORTUNITY_RULES,
  searchOpportunityForRow,
} from "./search-opportunities";

type Window = SeoPageDiscovery["recent"];
type Query = Window & { propertyId: string };
type Page = SeoPageDiscovery["pages"][number];
type Counts = Page["totals"];
type Read = (args: Record<string, unknown>) => Promise<unknown>;
const zero = { clicks: 0, impressions: 0 };
const DAYS_TO_COMPARE = 28;
const DAY_MS = 86_400_000;
// Screening thresholds for choosing pages to investigate. A query must independently support an edit.
const MIN_VISIBILITY = 50;
const MIN_IMPRESSION_GAIN = 20;
const MIN_CLICK_LOSS = 3;
const MIN_RELATIVE_CHANGE = 0.2;
const reasons = ["lostClicks", "gainingImpressions", "lowCtr"] as const;
const counts = gscNumberSchema.pipe(z.number().int().safe());
const report = z.object({
  rows: z
    .array(
      z.object({
        keys: z.tuple([seoUrlSchema]),
        clicks: counts,
        impressions: counts,
      }),
    )
    .max(SEO_STATS_MAX_ROWS)
    .default([]),
});

function byPage(input: unknown) {
  const body = unwrapNativeStatistics(input, [
    "rows",
    "responseAggregationType",
  ]);
  if (
    (body.responseAggregationType !== undefined &&
      body.responseAggregationType !== "byPage") ||
    (!Array.isArray(body.rows) && body.responseAggregationType !== "byPage")
  )
    throw new Error("Search Console did not return page data");
  return body;
}

async function pagesIn(query: Query, read: Read, pageUrl?: string) {
  const args = pageUrl
    ? gscSearchAnalyticsArguments(
        nativeQuery(query, pageUrl),
        ["page"],
        1,
        "equals",
      )
    : gscReportArguments(
        { ...query, searchType: "web" },
        ["page"],
        SEO_STATS_MAX_ROWS,
      );
  const { rows } = report.parse(
    byPage(await read({ ...args, aggregation_type: "byPage" })),
  );
  const pages = new Map<string, Counts>();
  for (const {
    keys: [url],
    clicks,
    impressions,
  } of rows) {
    if (
      (pageUrl && url !== pageUrl) ||
      pages.has(url) ||
      !gscPropertyCovers(query.propertyId, [url])
    )
      throw new Error("Unexpected Search Console page");
    pages.set(url, { clicks, impressions });
  }
  return pages;
}

function topClickedPages(pages: ReadonlyMap<string, Counts>) {
  return Array.from(pages, ([pageUrl, counts]) => ({ pageUrl, ...counts }))
    .filter((page) => page.clicks > 0)
    .sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.impressions - a.impressions ||
        a.pageUrl.localeCompare(b.pageUrl),
    )
    .slice(0, MAX_TOP_CLICKED_PAGES);
}

function nativeQuery(query: Query, pageUrl: string): NativeStatisticsQuery {
  return {
    ...query,
    provider: "search_console",
    searchType: "web",
    channel: "organic",
    pageUrls: [pageUrl],
  };
}

function scores(totals: Counts, recent: Counts, previous: Counts) {
  const loss = previous.clicks - recent.clicks;
  const gain = recent.impressions - previous.impressions;
  return {
    lostClicks:
      loss >= Math.max(MIN_CLICK_LOSS, previous.clicks * MIN_RELATIVE_CHANGE)
        ? loss
        : 0,
    gainingImpressions:
      gain >=
      Math.max(MIN_IMPRESSION_GAIN, previous.impressions * MIN_RELATIVE_CHANGE)
        ? gain
        : 0,
    lowCtr:
      totals.impressions >= MIN_VISIBILITY &&
      totals.clicks / totals.impressions <=
        SEO_OPPORTUNITY_RULES.snippetReview.maxCtr
        ? totals.impressions
        : 0,
  };
}

export async function discoverAuditPages(
  query: Query,
  read: Read,
  saved?: SeoPageDiscovery,
): Promise<SeoPageDiscovery> {
  const recent = {
    from: new Date(Date.parse(query.to) - (DAYS_TO_COMPARE - 1) * DAY_MS)
      .toISOString()
      .slice(0, 10),
    to: query.to,
  };
  const previous = previousSeoPeriod(recent.from, recent.to);
  if (previous.from < query.from || !withinSearchConsoleRetention(query.from))
    throw new Error("Audit dates do not cover both comparison periods");
  const windows = [query, { ...query, ...recent }, { ...query, ...previous }];
  const [audit, currentWindow, priorWindow] = await Promise.allSettled(
    windows.map((period) => pagesIn(period, read)),
  );
  if (audit.status === "rejected") throw audit.reason;
  const all = audit.value;
  const destinations = saved?.topClickedPages ?? topClickedPages(all);
  if (
    currentWindow.status === "rejected" ||
    priorWindow.status === "rejected"
  ) {
    return {
      recent,
      previous,
      pages: saved?.pages ?? [],
      limited: saved?.limited ?? false,
      comparisonIncomplete: true,
      topClickedPages: destinations,
    };
  }
  const now = currentWindow.value;
  const before = priorWindow.value;
  let comparisonIncomplete = false;
  const urls = new Set([...all.keys(), ...now.keys(), ...before.keys()]);
  const candidates = Array.from(urls, (url) => ({
    url,
    scores: scores(
      all.get(url) ?? zero,
      now.get(url) ?? zero,
      before.get(url) ?? zero,
    ),
  }));
  const ranked = reasons.map((reason) =>
    candidates
      .filter((page) => page.scores[reason] > 0)
      .sort(
        (a, b) =>
          b.scores[reason] - a.scores[reason] || a.url.localeCompare(b.url),
      ),
  );
  // Give each signal a slot before filling the remaining places.
  const selected = new Set<string>();
  for (
    let i = 0;
    ranked.some((list) => i < list.length) &&
    selected.size < MAX_DISCOVERED_PAGES;
    i++
  ) {
    for (const list of ranked) {
      if (list[i]) selected.add(list[i].url);
      if (selected.size === MAX_DISCOVERED_PAGES) break;
    }
  }
  const pages: Page[] = [];
  const limited =
    [all, now, before].some((map) => map.size === SEO_STATS_MAX_ROWS) ||
    candidates.filter((page) => reasons.some((r) => page.scores[r] > 0))
      .length > selected.size;
  for (const pageUrl of selected) {
    // A missing row in a property-wide top list cannot establish zero. Read that URL exactly.
    const counts = await Promise.all(
      [all, now, before].map(
        async (map, i) =>
          map.get(pageUrl) ??
          (await pagesIn(windows[i], read, pageUrl)).get(pageUrl) ??
          zero,
      ),
    ).catch(() => undefined);
    const cached = saved?.pages.find((page) => page.pageUrl === pageUrl);
    if (!counts) {
      comparisonIncomplete = true;
      if (cached) pages.push(cached);
      continue;
    }
    const [totals, current, baseline] = counts;
    const confirmed = scores(totals, current, baseline);
    const reason = reasons.find((r) => confirmed[r] > 0);
    if (!reason) continue;
    pages.push({
      pageUrl,
      reason,
      totals,
      recent: current,
      previous: baseline,
      query: cached?.query ?? null,
      suggestion: cached?.suggestion ?? null,
      expectedEffect: cached?.expectedEffect,
      queryUnavailable: cached?.queryUnavailable,
    });
  }
  return checkDiscoveredQueries(
    query,
    {
      recent,
      previous,
      limited,
      pages,
      topClickedPages: destinations,
      ...(comparisonIncomplete && { comparisonIncomplete: true }),
    },
    read,
  );
}

async function checkDiscoveredQueries(
  query: Query,
  discovery: SeoPageDiscovery,
  read: Read,
  retry = false,
): Promise<SeoPageDiscovery> {
  if (!withinSearchConsoleRetention(query.from))
    throw new Error("Audit period is outside Search Console retention");
  let limited = discovery.limited;
  const pages: Page[] = [];
  for (const page of discovery.pages) {
    if (retry && !page.queryUnavailable) {
      pages.push(page);
      continue;
    }
    const scope = nativeQuery({ ...query, ...discovery.recent }, page.pageUrl);
    try {
      const args = gscSearchAnalyticsArguments(
        scope,
        ["query", "page"],
        SEO_SEARCH_QUERY_ROW_LIMIT,
        "equals",
      );
      const result = normalizeGscQueries(
        scope,
        byPage(await read({ ...args, aggregation_type: "byPage" })),
      );
      limited ||= result.truncated;
      const rows = result.rows.sort(
        (a, b) =>
          b.impressions - a.impressions || a.query.localeCompare(b.query),
      );
      let evidence = rows[0] ?? null;
      let suggestion: string | null = null;
      let expectedEffect: string | undefined;
      for (const row of rows) {
        const opportunity = searchOpportunityForRow(row, { ...scope, rows });
        if (!page.recent.impressions || !opportunity) continue;
        evidence = row;
        suggestion = opportunity.title;
        expectedEffect = opportunity.expectedEffect;
        break;
      }
      pages.push({
        ...page,
        query: evidence,
        suggestion,
        expectedEffect,
        queryUnavailable: undefined,
      });
    } catch {
      pages.push(page.query ? page : { ...page, queryUnavailable: true });
    }
  }
  return { ...discovery, limited, pages };
}

async function readPageDiscovery(
  query: Query,
  read: Read,
  approved: boolean,
  saved?: SeoPageDiscovery,
) {
  if (!approved) return saved;
  if (!saved || saved.comparisonIncomplete)
    return discoverAuditPages(query, read, saved);
  const recovered = saved.pages.some((page) => page.queryUnavailable)
    ? await checkDiscoveredQueries(query, saved, read, true)
    : saved;
  if (recovered.topClickedPages || !withinSearchConsoleRetention(query.from))
    return recovered;
  try {
    return {
      ...recovered,
      topClickedPages: topClickedPages(await pagesIn(query, read)),
    };
  } catch {
    return recovered;
  }
}

export async function readAuditPropertyEvidence(
  query: Query,
  read: Read,
  enabled: boolean,
  discover: boolean,
  cached?: Pick<NativeSeoMetrics, "auditPageDiscovery" | "auditPropertyTotals">,
) {
  const [auditPropertyTotals, auditPageDiscovery] = await Promise.all([
    cached?.auditPropertyTotals ??
      (enabled
        ? readGscPropertyTotals(query, read).catch(() => undefined)
        : undefined),
    readPageDiscovery(query, read, discover, cached?.auditPageDiscovery).catch(
      () => cached?.auditPageDiscovery,
    ),
  ]);
  return {
    ...(auditPropertyTotals && { auditPropertyTotals }),
    ...(auditPageDiscovery && { auditPageDiscovery }),
  };
}
