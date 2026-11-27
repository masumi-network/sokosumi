import { z } from "@hono/zod-openapi";
import { seoDeviceSchema } from "./seo-audit-coverage.schema";

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

/** The newest rows the admin page shows; total counts them all. */
export const ADMIN_SEO_IMPACT_LIMIT = 500;

export const adminSeoImpactQuery = z.object({
  period: z.enum(["90", "365", "all"]).default("90"),
});

// Not z.iso.date(): the generated client would read `format: date` as a Date.
export const searchConsoleDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: "2026-11-27" });

export const seoImpactClosingCheck = z.object({
  rowId: z.string(),
  device: seoDeviceSchema,
  baselineObservationId: z.uuid(),
  checkedObservationId: z.uuid(),
});

const adminSeoImpactClosingCheck = seoImpactClosingCheck
  .pick({ rowId: true, device: true })
  .extend({
    baselineObservedAt: z.iso.datetime(),
    checkedObservedAt: z.iso.datetime(),
  });

export const adminSeoImpactRow = z.object({
  id: z.uuid(),
  organizationSlug: z.string().nullable(),
  projectId: z.uuid(),
  projectName: z.string(),
  pageUrl: z.string(),
  /** The suggestion's title when the change was recorded. */
  suggestionTitle: z.string().nullable(),
  changeSource: z.enum(["cuso_done", "audit_recheck"]),
  changedAt: z.iso.datetime(),
  closingEvidence: z.array(adminSeoImpactClosingCheck).nullable(),
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
