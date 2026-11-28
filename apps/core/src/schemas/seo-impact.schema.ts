import { z } from "@hono/zod-openapi";

export const SEO_IMPACT_STATES = [
  "waiting_crawl",
  "waiting_window",
  /** Core stored the worker's input: the SEO worker can claim it. */
  "ready",
  /** The worker said the window can still fill: Core reads again on its day. */
  "waiting_retry",
  "measured",
  "not_measurable",
] as const;

/** Why a row still waits for its crawl, or cannot be measured. */
export const SEO_IMPACT_REASONS = [
  "no_cuso",
  "not_connected",
  "no_property",
  "inspection_failed",
  "not_crawled_yet",
  /** Every claim of the change ended without a verdict. */
  "worker_failed",
] as const;
export type SeoImpactReason = (typeof SEO_IMPACT_REASONS)[number];

/** How a page change entered impact tracking. */
export const SEO_IMPACT_SOURCES = ["cuso_done", "audit_recheck"] as const;

/** The newest rows the admin page shows; total counts them all. */
export const ADMIN_SEO_IMPACT_LIMIT = 500;

export const adminSeoImpactQuery = z.object({
  period: z.enum(["90", "365", "all"]).default("90"),
  state: z.enum(SEO_IMPACT_STATES).optional(),
  source: z.enum(SEO_IMPACT_SOURCES).optional(),
});

// Not z.iso.date(): the generated client would read `format: date` as a Date.
export const searchConsoleDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: "2026-11-27" });

export const adminSeoImpactRow = z.object({
  id: z.uuid(),
  organizationSlug: z.string().nullable(),
  projectId: z.uuid(),
  projectName: z.string(),
  pageUrl: z.string(),
  /** The suggestion's title when the change was recorded. */
  suggestionTitle: z.string().nullable(),
  changeSource: z.enum(SEO_IMPACT_SOURCES),
  changedAt: z.iso.datetime(),
  crawledAt: z.iso.datetime().nullable(),
  windowStart: searchConsoleDate.nullable(),
  windowEnd: searchConsoleDate.nullable(),
  /** When Search Console data for the whole window is final. */
  windowReadyOn: searchConsoleDate.nullable(),
  state: z.enum(SEO_IMPACT_STATES),
  reason: z.enum(SEO_IMPACT_REASONS).nullable(),
});

export const adminSeoImpactVerdicts = z
  .object({
    /** The rows that match every filter. */
    total: z.number().int().nonnegative(),
    /** Each state's rows in the period and source, whatever state is picked. */
    counts: z.array(
      z.object({
        state: z.enum(SEO_IMPACT_STATES),
        count: z.number().int().nonnegative(),
      }),
    ),
    rows: z.array(adminSeoImpactRow),
  })
  .openapi("AdminSeoImpactVerdicts");
