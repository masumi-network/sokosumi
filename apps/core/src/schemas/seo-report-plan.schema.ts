import { z } from "@hono/zod-openapi";
import { seoUrlSchema } from "./seo-page.schema";

/** Evidence from a single imported report. The viewer's private goal is applied when reading it. */
export const seoReportPlanCandidate = z.object({
  kind: z.enum([
    "access",
    "completion",
    "broken_link",
    "repair",
    "content",
    "internal_link",
    "experiment",
  ]),
  pageUrl: seoUrlSchema,
  title: z.string(),
  reason: z.string(),
  evidence: z.array(z.string()),
  nextCheck: z.string().optional(),
  alternative: z.string().optional(),
  severity: z.enum(["critical", "major", "minor"]).optional(),
  destinations: z.array(seoUrlSchema).optional(),
  actionId: z.string().optional(),
  queries: z.array(z.string()).optional(),
  season: z
    .object({
      country: z.string(),
      through: z.iso.date(),
      windows: z
        .array(z.object({ month: z.string(), peaks: z.array(z.string()) }))
        .optional(),
      pageGap: z.boolean().optional(),
    })
    .optional(),
});
export type SeoReportPlanCandidate = z.infer<typeof seoReportPlanCandidate>;

export const seoReportPlanSignal = z.object({
  query: z.string(),
  pageUrl: seoUrlSchema,
  source: z.enum([
    "gap",
    "rank",
    "editorial",
    "trend",
    "trend_flat",
    "covered",
    "season",
  ]),
  evidence: z.string(),
  peaks: z.array(z.string()).optional(),
});
