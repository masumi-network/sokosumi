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
