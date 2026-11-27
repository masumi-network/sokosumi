import { seoBrandMatcher } from "@sokosumi/utils";
import type { SiteTrafficReport } from "@/schemas/seo-site-traffic.schema";
import { withinPeriod } from "./native-statistics";

/** Rows per date and query read. A read of 10,000 long queries can pass the 5 MB answer limit. */
export const BRAND_QUERY_BATCH = 5_000;
const MAX_BATCHES = 6;
/** No new read starts after this time, so the split cannot use up the time of the report. */
export const BRAND_READ_BUDGET_MS = 20_000;

interface BrandQueryRow {
  keys: string[];
  clicks: number;
  impressions: number;
}
type BrandSplit = NonNullable<SiteTrafficReport["brand"]>;

/**
 * Splits the date and query rows of one period by the owner's brand terms. Search
 * Console orders rows by clicks, so a read that stops at the batch limit drops the
 * weakest rows. Clicks that Google lists under no query are in no row at all: the
 * reader gets them as the daily total minus both sides. A malformed grouping, a date
 * outside the period, an empty query or a duplicate row refuses the whole split. A read
 * that stops at the row limit or the time budget gives the rows so far, marked `limited`.
 */
export async function readBrandSplit(
  terms: string[],
  period: { from: string; to: string },
  rows: (start: number) => Promise<BrandQueryRow[]>,
  now: () => number = Date.now,
): Promise<BrandSplit> {
  const end = now() + BRAND_READ_BUDGET_MS;
  const branded = seoBrandMatcher(terms);
  const days = new Map<string, BrandSplit["daily"][number]>();
  const seen = new Set<string>();
  let limited = false;
  for (let batch = 0; ; batch++) {
    const page = await rows(batch * BRAND_QUERY_BATCH);
    for (const { keys, clicks, impressions } of page) {
      const [date, query] = keys;
      if (keys.length !== 2 || !withinPeriod(date, period) || !query.trim())
        throw new Error("Unexpected brand split row");
      const identity = JSON.stringify(keys);
      if (seen.has(identity)) throw new Error("Duplicate brand split row");
      seen.add(identity);
      const day = days.get(date) ?? {
        date,
        branded: { clicks: 0, impressions: 0 },
        nonBranded: { clicks: 0, impressions: 0 },
      };
      days.set(date, day);
      const side = branded(query) ? day.branded : day.nonBranded;
      side.clicks += clicks;
      side.impressions += impressions;
    }
    if (page.length < BRAND_QUERY_BATCH) break;
    if (batch + 1 === MAX_BATCHES || now() >= end) {
      limited = true;
      break;
    }
  }
  return {
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    limited,
    terms,
  };
}
