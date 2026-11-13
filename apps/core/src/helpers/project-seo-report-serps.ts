import { z } from "@hono/zod-openapi";

import { seoDeviceSchema } from "@/schemas/project-seo.schema";

/** Organic rows a SERP read keeps, in rank_group order (seo-bot `serps[].top`). */
export const SEO_SERP_TOP_ROWS = 20;
/** One entry per keyword and device: 50 keywords on 2 devices fill 100. */
const SERP_READS = 500;
const LIST_ITEMS = 100;
const SHORT_TEXT = 300;
const DOMAIN_CHARS = 255;

const shortText = z.string().max(SHORT_TEXT);
const domain = z.string().min(1).max(DOMAIN_CHARS);

/**
 * One SERP read of a focused result (seo-bot `AnalysisReport.serps`). `aiOverview` is null when the read did not
 * ask for async AI Overviews and none is on the page: "not checked", never "no AI Overview". `asyncLoaded` tells
 * whether the read asked. `pageCited` null: no reference matches the page by URL and a Google-wrapped reference has
 * no known domain or a domain on the page's host (not determined). `featured` is null when the page had no
 * featured snippet.
 */
export const seoSerpReadSchema = z.object({
  keyword: z.string().max(20_000),
  device: seoDeviceSchema,
  sourceRef: z.string().max(20_000),
  observedAt: z.string().datetime(),
  itemTypes: z.array(shortText).max(LIST_ITEMS),
  aiOverview: z
    .object({
      shown: z.boolean(),
      asyncLoaded: z.boolean(),
      citedDomains: z.array(domain).max(LIST_ITEMS),
      pageCited: z.boolean().nullable(),
    })
    .nullable(),
  featured: z
    .object({ domain: domain.nullable(), pageOwned: z.boolean() })
    .nullable(),
  paaOwned: z.boolean(),
  top: z
    .array(
      z.object({
        rank: z.number().int().positive(),
        domain: domain.nullable(),
      }),
    )
    .max(SEO_SERP_TOP_ROWS),
  suspect: z.boolean(),
});
export type SeoSerpRead = z.infer<typeof seoSerpReadSchema>;
export const seoSerpReadsSchema = z.array(seoSerpReadSchema).max(SERP_READS);
/** Rule ids of seo-bot `agent/lib/monitor-rows.ts` that fired in the Run. */
export const seoAlertRowsSchema = z.array(shortText).max(LIST_ITEMS);

export const SEO_SERPS_NOT_READ =
  "Some SERP details of this check are not readable: they are left out of SERP features and share of voice.";
export const SEO_ALERT_ROWS_NOT_READ =
  "The monitor alert rows of this check are not readable: they are left out.";

/**
 * The optional SERP fields of a focused result. A value Core cannot read is dropped with a note: the paid
 * positions and the readable SERP reads of the same result must still import.
 */
export function focusedSerpFields(raw: Record<string, unknown>): {
  serps?: SeoSerpRead[];
  alertRows?: string[];
  notes: string[];
} {
  const notes: string[] = [];
  let serps: SeoSerpRead[] | undefined;
  if (raw.serps !== undefined && !Array.isArray(raw.serps))
    notes.push(SEO_SERPS_NOT_READ);
  else if (Array.isArray(raw.serps)) {
    // Each SERP read stands alone: one bad entry drops itself, not the others.
    serps = raw.serps.slice(0, SERP_READS).flatMap((entry) => {
      const parsed = seoSerpReadSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
    if (serps.length < raw.serps.length) notes.push(SEO_SERPS_NOT_READ);
  }
  const alertRows =
    raw.alertRows === undefined
      ? undefined
      : seoAlertRowsSchema.safeParse(raw.alertRows);
  if (alertRows && !alertRows.success) notes.push(SEO_ALERT_ROWS_NOT_READ);
  return {
    ...(serps ? { serps } : {}),
    ...(alertRows?.success ? { alertRows: alertRows.data } : {}),
    notes,
  };
}
