import { z } from "@hono/zod-openapi";
import { seoSearchSiteHost } from "@sokosumi/utils";
import type { SeoIndexedPage } from "@/schemas/project-seo.schema";
import { seoUrlSchema } from "@/schemas/seo-page.schema";
import type {
  SiteTrafficInput,
  SiteTrafficReport,
} from "@/schemas/seo-site-traffic.schema";
import { auditPerformancePage } from "./audit-performance-pages";
import { gscPropertyCovers } from "./native-gsc-property";
import { gscNumberSchema } from "./native-gsc-queries";
import {
  escapeRegex,
  gscPageFilterArguments,
  SEO_STATS_MAX_DAYS,
  unwrapNativeStatistics,
  withinPeriod,
} from "./native-statistics";

const PAGE_BATCH = 250;
const MAX_BATCHES = 10;
const row = z.object({
  keys: z.array(z.string()).default([]),
  clicks: gscNumberSchema.pipe(z.number().int()),
  impressions: gscNumberSchema.pipe(z.number().int()),
});
const response = z.object({
  rows: z.array(row).max(PAGE_BATCH).default([]),
  responseAggregationType: z.string().optional(),
});
const dailyResponse = response.extend({
  rows: z.array(row).max(SEO_STATS_MAX_DAYS).default([]),
});
function readRows(value: unknown, schema = response) {
  const payload = unwrapNativeStatistics(value, [
    "rows",
    "responseAggregationType",
  ]);
  if (
    Object.keys(payload).length &&
    !("rows" in payload) &&
    !("responseAggregationType" in payload)
  )
    throw new Error("Unrecognized Search Console traffic response");
  return schema.parse(payload).rows;
}
/** Every provider call, including the headline total, carries the same site boundary. */
export async function readSiteTraffic(
  input: SiteTrafficInput,
  siteUrl: string,
  selected: string[],
  inspections: SeoIndexedPage[],
  read: (args: Record<string, unknown>) => Promise<unknown>,
) {
  const site = seoSearchSiteHost(siteUrl);
  if (
    !selected.length ||
    !gscPropertyCovers(input.propertyId, selected) ||
    selected.some((url) => seoSearchSiteHost(url) !== site)
  )
    throw new Error("Pages and property must cover the open website");
  const targets = new Map<string, string>();
  for (const url of selected) {
    const page = auditPerformancePage(
      input.propertyId,
      url,
      inspections.find((p) => p.pageUrl === url),
    );
    targets.set(url, page.measuredUrl);
  }
  const selection = input.pageUrls ?? selected;
  if (
    input.pageUrls &&
    (input.scope !== "selected" ||
      !gscPropertyCovers(input.propertyId, selection) ||
      selection.some((url) => seoSearchSiteHost(url) !== site))
  )
    throw new Error("Page filter must belong to this website and property");
  const chosen = new Set(selection.map((url) => targets.get(url) ?? url));
  const allowed = new Set([...selection, ...chosen]);
  for (const [submitted, measured] of targets)
    if (chosen.has(measured)) allowed.add(submitted);
  const siteExpression = input.propertyId.startsWith("sc-domain:")
    ? "^https?://(?:www\\.)?" + escapeRegex(site) + "/"
    : "^" + escapeRegex(new URL(input.propertyId).href);
  const expression =
    input.scope === "site"
      ? siteExpression
      : "^(?:" + [...allowed].map(escapeRegex).join("|") + ")$";
  const args = (dimensions: string[], start: number, limit: number) =>
    gscPageFilterArguments(
      input,
      dimensions,
      limit,
      start,
      "includingRegex",
      expression,
    );
  const [totalRows, first, dailyRows] = await Promise.all([
    read(args([], 0, 1)).then(readRows),
    read(args(["page"], 0, PAGE_BATCH)).then(readRows),
    input.includeDaily
      ? read(args(["date"], 0, SEO_STATS_MAX_DAYS)).then(
          (value) => readRows(value, dailyResponse),
          () => undefined,
        )
      : undefined,
  ]);
  if (totalRows.length > 1 || totalRows.some((r) => r.keys.length))
    throw new Error("Unexpected totals grouping");
  type Page = SiteTrafficReport["pages"][number];
  const pages = new Map<string, Page>();
  function group(url: string) {
    const key = targets.get(url) ?? url;
    const existing = pages.get(key);
    if (existing) return existing;
    const created: Page = {
      url: key,
      submitted: selected.filter((p) => targets.get(p) === key),
      variants: [],
      clicks: 0,
      impressions: 0,
    };
    pages.set(key, created);
    return created;
  }
  const seen = new Set<string>();
  let batch = first;
  let limited = false;
  for (let batchNumber = 1; ; batchNumber++) {
    for (const { keys, clicks, impressions } of batch) {
      const url = seoUrlSchema.parse(keys[0]);
      if (
        keys.length !== 1 ||
        seoSearchSiteHost(url) !== site ||
        !gscPropertyCovers(input.propertyId, [url]) ||
        (input.scope === "selected" && !allowed.has(url)) ||
        seen.has(url)
      )
        throw new Error("Unexpected page in Search Console response");
      seen.add(url);
      const item = group(url);
      item.clicks += clicks;
      item.impressions += impressions;
      item.variants.push({ url, clicks, impressions });
    }
    if (batch.length < PAGE_BATCH) break;
    if (batchNumber === MAX_BATCHES) {
      limited = true;
      break;
    }
    batch = readRows(
      await read(args(["page"], batchNumber * PAGE_BATCH, PAGE_BATCH)),
    );
  }
  const daily = dailyRows
    ?.map(({ keys, clicks, impressions }) => {
      if (keys.length !== 1 || !withinPeriod(keys[0], input))
        throw new Error("Unexpected traffic date");
      return { date: keys[0], clicks, impressions };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (daily && new Set(daily.map((day) => day.date)).size !== daily.length)
    throw new Error("Duplicate traffic date");
  const total = totalRows[0];
  return {
    site,
    propertyId: input.propertyId,
    from: input.from,
    to: input.to,
    ...(daily && { daily }),
    limited,
    totals: total
      ? { clicks: total.clicks, impressions: total.impressions }
      : null,
    pages: [...pages.values()],
  };
}
