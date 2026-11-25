import { z } from "@hono/zod-openapi";

export const SEO_IMPACT_STATES = [
  "waiting_crawl",
  "waiting_window",
  "not_measurable",
] as const;

/** Why a row still waits for its crawl, or cannot be measured. */
export const SEO_IMPACT_REASONS = [
  "no_cuso",
  "not_connected",
  "no_property",
  "page_outside_property",
  "inspection_failed",
  "not_crawled_yet",
] as const;
export type SeoImpactReason = (typeof SEO_IMPACT_REASONS)[number];

/** The newest rows the admin page shows; total counts them all. */
export const ADMIN_SEO_IMPACT_LIMIT = 500;

export const adminSeoImpactQuery = z.object({
  period: z.enum(["90", "365", "all"]).default("90"),
});

// Not z.iso.date(): the generated client would read `format: date` as a Date.
const searchConsoleDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: "2026-11-27" });

export const adminSeoImpactRow = z.object({
  id: z.uuid(),
  organizationSlug: z.string().nullable(),
  projectId: z.uuid(),
  projectName: z.string(),
  pageUrl: z.string(),
  suggestionTitle: z.string().nullable(),
  changeSource: z.enum(["cuso_done", "audit_recheck"]),
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
    total: z.number().int().nonnegative(),
    rows: z.array(adminSeoImpactRow),
  })
  .openapi("AdminSeoImpactVerdicts");
