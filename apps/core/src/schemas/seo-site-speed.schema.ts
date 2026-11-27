import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoIdSchema, seoUrlSchema } from "./seo-page.schema";
import { seoPageSpeedRow, speedDay } from "./seo-page-speed.schema";

/**
 * Core's cap on the pages of one site speed table. The worker's tiered plan holds at most 30 pages; 40 leaves
 * room for a worker that adds extra pages. Core must not be stricter than the worker.
 */
export const SITE_SPEED_ROWS = 40;
export const SITE_SPEED_WHY_CHARS = 200;
export const SITE_SPEED_GROUP_CHARS = 200;
export const SITE_SPEED_CAUSES = [
  "action",
  "keyword",
  "template",
  "entry",
  "risk",
] as const;
export const SITE_SPEED_TIERS = ["full", "reduced", "none"] as const;

/** Why the audit read no speed data. A code: the worker's own sentence is never stored. */
export const SITE_SPEED_GAPS = ["deadline", "quota", "other"] as const;
const share = z.number().min(0).max(1);
export const siteSpeedMixPeriod = z.object({ first: speedDay, last: speedDay });
/** How a page with the reduced test was read: one device, chosen from the device mix of the page loads. */
export const siteSpeedCheck = z.object({
  device: z.enum(["mobile", "desktop"]),
  basis: z.enum(["crux-url", "crux-origin", "page-type", "default"]),
  /** The share of page loads per device, 0 to 1. Null: CrUX gave no mix. */
  mix: z.union([
    z.object({
      level: z.enum(["url", "origin"]),
      phone: share,
      desktop: share,
      tablet: share,
      period: z.union([siteSpeedMixPeriod, z.null()]),
    }),
    z.null(),
  ]),
  notChecked: z.enum(SITE_SPEED_GAPS).nullable(),
});

export const storedSiteSpeedRow = z.object({
  url: seoUrlSchema,
  /** Core's own match of the URL against the audit's pages, never the worker's page number. */
  audited: z.boolean(),
  /** The URL template the worker grouped the page under. */
  group: z.string().max(SITE_SPEED_GROUP_CHARS).optional(),
  cause: z.enum(SITE_SPEED_CAUSES).optional(),
  why: z.string().min(1).max(SITE_SPEED_WHY_CHARS).optional(),
  /** Absent in a Report from before the worker's test tiers. */
  tier: z.enum(SITE_SPEED_TIERS).optional(),
  /** Only on a page with the reduced test. */
  check: siteSpeedCheck.optional(),
  /**
   * For an audited page, only the devices whose report read shows more than the same audit's pageSpeed read; the
   * workspace fills the other devices from pageSpeed.
   */
  devices: z.array(seoPageSpeedRow).max(2),
});
export const storedSiteSpeed = z.object({
  rows: z.array(storedSiteSpeedRow).max(SITE_SPEED_ROWS),
  /** Rows of the Report that Core left out: a foreign host, an unsafe URL, a repeated page or one past the cap. */
  dropped: z.number().int().nonnegative(),
  /** Pages the audit planned and did not test. `limit`: the audit's cap on pages. */
  notChecked: z
    .object({
      count: z.number().int().nonnegative(),
      reason: z.enum(["limit", ...SITE_SPEED_GAPS]),
    })
    .optional(),
});
export type StoredSiteSpeed = z.infer<typeof storedSiteSpeed>;
export const seoSiteSpeedSchema = storedSiteSpeed
  .extend({ observationId: seoIdSchema, observedAt: dateTimeSchema })
  .openapi("ProjectSeoSiteSpeed");
export const workspaceSiteSpeedFields = {
  /** The newest site audit's speed table in the period. Null unless the view holds every page of that audit. */
  siteSpeed: z.union([seoSiteSpeedSchema, z.null()]).optional(),
};
