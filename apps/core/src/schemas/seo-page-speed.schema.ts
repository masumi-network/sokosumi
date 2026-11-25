import { z } from "@hono/zod-openapi";
import { seoUrlSchema } from "./seo-page.schema";

export const speedValue = z.number().finite().nonnegative().nullable();
export const labTimings = z.object({
  lcp: speedValue,
  cls: speedValue,
  fcp: speedValue,
  tbt: speedValue,
  si: speedValue,
});
export const fieldTimings = z.object({
  lcp: speedValue,
  cls: speedValue,
  fcp: speedValue,
  inp: speedValue,
  ttfb: speedValue,
});
const score = z.number().int().min(0).max(100).optional();
export const lighthouseScores = z.object({
  performance: score,
  accessibility: score,
  bestPractices: score,
  seo: score,
  agenticBrowsing: score,
});
export const speedInsight = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,100}$/),
  title: z.string().min(1).max(180),
  detail: z.string().min(1).max(600),
  action: z.string().min(1).max(600),
});
export const lighthouseDetails = z.object({
  scores: lighthouseScores,
  insights: z.array(speedInsight).max(20),
  measuredAt: z.string().datetime().optional(),
});
const gap = z.object({
  status: z.enum([
    "not_checked",
    "no_data",
    "quota",
    "budget",
    "unsafe",
    "deadline",
    "unavailable",
  ]),
});
export const seoPageSpeedRow = z.object({
  pageUrl: seoUrlSchema,
  testedUrl: seoUrlSchema,
  device: z.enum(["mobile", "desktop"]),
  lab: z.union([
    gap,
    z.object({
      status: z.literal("measured"),
      median: labTimings,
      runs: z.number().int().positive(),
      ok: z.number().int().positive(),
      lighthouse: z.string().max(32).nullable(),
      pageSpeed: lighthouseDetails.optional(),
    }),
  ]),
  field: z.union([
    gap,
    z.object({
      status: z.literal("measured"),
      level: z.enum(["url", "origin", "normalized"]),
      url: seoUrlSchema,
      p75: fieldTimings,
      period: z
        .object({ first: z.string().date(), last: z.string().date() })
        .nullable(),
    }),
  ]),
});
export const seoPageSpeed = z.array(seoPageSpeedRow).max(20);
export type PageSpeedRows = z.infer<typeof seoPageSpeed>;
