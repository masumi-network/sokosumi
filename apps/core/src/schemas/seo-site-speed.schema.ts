import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoIdSchema, seoUrlSchema } from "./seo-page.schema";
import { seoPageSpeedRow } from "./seo-page-speed.schema";

/** The SEO worker's cap on the pages of one site speed table. */
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

const row = z.object({
  url: seoUrlSchema,
  /** Core's own match of the URL against the audit's pages, never the worker's page number. */
  audited: z.boolean(),
  /** The URL template the worker grouped the page under. */
  group: z.string().max(SITE_SPEED_GROUP_CHARS).optional(),
  cause: z.enum(SITE_SPEED_CAUSES).optional(),
  why: z.string().min(1).max(SITE_SPEED_WHY_CHARS).optional(),
  /** Absent in a Report from before the worker's test tiers. */
  tier: z.enum(SITE_SPEED_TIERS).optional(),
  /** Stored empty for an audited page: the workspace fills it from the same audit's pageSpeed. */
  devices: z.array(seoPageSpeedRow).max(2),
});
export const storedSiteSpeed = z.object({
  rows: z.array(row).max(SITE_SPEED_ROWS),
  /** Rows of the Report that Core left out: a foreign host, an unsafe URL, a repeated page or one past the cap. */
  dropped: z.number().int().nonnegative(),
});
export type StoredSiteSpeed = z.infer<typeof storedSiteSpeed>;
export const seoSiteSpeedSchema = storedSiteSpeed
  .extend({ observationId: seoIdSchema, observedAt: dateTimeSchema })
  .openapi("ProjectSeoSiteSpeed");
export const workspaceSiteSpeedFields = {
  /** The newest site audit's speed table in the period. Null unless the view holds every page of that audit. */
  siteSpeed: z.union([seoSiteSpeedSchema, z.null()]).optional(),
};
