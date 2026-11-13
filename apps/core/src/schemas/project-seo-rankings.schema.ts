import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/** Points one history keeps: the newest, so a daily monitor shows about three months. */
export const SEO_RANK_HISTORY_POINTS = 90;
// The values of seoDeviceSchema. This file stays free of project-seo.schema, which imports it.
const device = z.enum(["mobile", "desktop"]);

/** One paid position read of a keyword on one page and device. "not_in_range" is a read: the page was not in the checked results. */
export const seoPositionPointSchema = z
  .object({
    observedAt: dateTimeSchema,
    observationId: z.string(),
    position: z.number().nullable(),
    positionStatus: z.enum(["ranked", "not_in_range", "unavailable"]),
    device: z.union([device, z.null()]),
  })
  .openapi("ProjectSeoPositionPoint");

/** Keyword series one workspace sends: the ones with the newest reads. */
export const SEO_SERP_SERIES_MAX = 500;

/**
 * What one paid SERP read showed (seo-bot `serps[]`). `aiOverview` null: the read did not ask for it, so "not
 * checked", never "no AI Overview". `featured` null: no featured snippet. A suspect read carries no SERP data.
 */
export const seoSerpPointSchema = z
  .object({
    observedAt: dateTimeSchema,
    observationId: z.string(),
    itemTypes: z.array(z.string()),
    aiOverview: z.union([
      z.object({
        shown: z.boolean(),
        asyncLoaded: z.boolean(),
        citedDomains: z.array(z.string()),
        pageCited: z.boolean(),
      }),
      z.null(),
    ]),
    featured: z.union([
      z.object({ domain: z.string().nullable(), pageOwned: z.boolean() }),
      z.null(),
    ]),
    paaOwned: z.boolean(),
    suspect: z.boolean(),
  })
  .openapi("ProjectSeoSerpPoint");

/** The SERP reads of one keyword, device and Market over time, newest last. */
export const seoSerpSeriesSchema = z
  .object({
    keyword: z.string(),
    device,
    countryCode: z.string(),
    languageCode: z.string(),
    points: z.array(seoSerpPointSchema).max(SEO_RANK_HISTORY_POINTS),
  })
  .openapi("ProjectSeoSerpSeries");
