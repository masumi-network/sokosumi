import { z } from "@hono/zod-openapi";
import { isValidTimezone } from "@sokosumi/utils";

import { isSeoMonitorCron } from "@/lib/seo/monitor-cron";

export const SEO_MAX_MONITOR_RUNS = 31;
/** Rows of each kind a monitor change lists. The counts cover all of them. */
export const SEO_MONITOR_CHANGE_ITEMS = 10;

const dateTime = z.string().datetime();
const device = z.enum(["mobile", "desktop"]);

/** The Run rule a person approved for an SEO monitor: daily, weekly or monthly at one time, a fixed count or until stopped. */
export const seoMonitorRuleSchema = z
  .object({
    expr: z.string().max(100).refine(isSeoMonitorCron, {
      message: "An SEO monitor runs daily, weekly or monthly at one time",
    }),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine(isValidTimezone, { message: "Unknown time zone" }),
    endsMode: z.enum(["AFTER", "NEVER"]),
    targetRunCount: z
      .union([z.number().int().min(1).max(SEO_MAX_MONITOR_RUNS), z.null()])
      .openapi({ description: "Total Runs when endsMode is AFTER, else null" }),
  })
  .strict()
  .refine(
    (rule) => (rule.endsMode === "AFTER") === (rule.targetRunCount !== null),
    {
      message:
        "targetRunCount is required with AFTER and not allowed with NEVER",
    },
  )
  .openapi("ProjectSeoMonitorRule");

const changedCheck = z.object({
  rowId: z.string(),
  title: z.string(),
  pageUrl: z.string(),
  device,
});

/** What the newest monitor Run changed against the Run before it. */
export const seoMonitorChangeSchema = z
  .object({
    from: dateTime,
    to: dateTime,
    /** False when the two Runs used another Market or rulebook: nothing is compared. */
    comparable: z.boolean(),
    newFailureCount: z.number().int().nonnegative(),
    fixedCount: z.number().int().nonnegative(),
    newFailures: z.array(changedCheck).max(SEO_MONITOR_CHANGE_ITEMS),
    fixed: z.array(changedCheck).max(SEO_MONITOR_CHANGE_ITEMS),
    /** Position moves beyond the noise band (ranks 1-3 ±2, 4-10 ±5, 11-20 ±7). */
    moves: z
      .array(
        z.object({
          keyword: z.string(),
          pageUrl: z.string(),
          device: z.union([device, z.null()]),
          from: z.number(),
          to: z.number(),
        }),
      )
      .max(SEO_MONITOR_CHANGE_ITEMS),
    moveCount: z.number().int().nonnegative(),
    /** Moves to a worse place. Drops come first in `moves`. */
    dropCount: z.number().int().nonnegative(),
  })
  .openapi("ProjectSeoMonitorChange");

export const seoMonitorLastRunSchema = z
  .object({
    at: dateTime,
    status: z.enum(["requested", "running", "completed", "failed"]),
    taskId: z.union([z.string(), z.null()]),
  })
  .openapi("ProjectSeoMonitorLastRun");

export type SeoMonitorRule = z.infer<typeof seoMonitorRuleSchema>;
export type SeoMonitorChange = z.infer<typeof seoMonitorChangeSchema>;
export type SeoMonitorLastRun = z.infer<typeof seoMonitorLastRunSchema>;
