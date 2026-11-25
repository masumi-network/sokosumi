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
/** The SEO worker's cap on the weekly periods of one CrUX History read. */
export const SPEED_HISTORY_WEEKS = 40;
export const SPEED_HISTORY_STATUSES = [
  "comparable",
  "incompatible_population",
  "unavailable",
  "legacy_unverified",
] as const;
/** A plain string: the generated client types a date format as Date and does not convert it here. */
export const speedDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekly = z.array(speedValue).max(SPEED_HISTORY_WEEKS);
/** CrUX History of a measured field. The series is present only for a comparable population. */
export const speedHistory = z.object({
  status: z.enum(SPEED_HISTORY_STATUSES),
  /** Each week's end date, oldest first. */
  weeks: z.array(speedDay).max(SPEED_HISTORY_WEEKS).optional(),
  /** The p75 per week, in the units of the field's p75 and aligned to weeks. Null: no data that week. */
  lcp: weekly.optional(),
  inp: weekly.optional(),
  cls: weekly.optional(),
});
export type SpeedHistory = z.infer<typeof speedHistory>;
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
      history: speedHistory.optional(),
    }),
  ]),
});
export const seoPageSpeed = z.array(seoPageSpeedRow).max(20);
export type PageSpeedRows = z.infer<typeof seoPageSpeed>;
