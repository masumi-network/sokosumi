import { z } from "@hono/zod-openapi";

import {
  requestSeoAnalysisSchema,
  SEO_MAX_MONITOR_RUNS,
} from "@/schemas/project-seo.schema";

export const SEO_MONITOR_MARKER = "seo_monitor: ";
export const SEO_MONITOR_CRON = {
  daily: "0 9 * * *",
  weekly: "0 9 * * 1",
} as const;
export const seoMonitorPlanSchema = z
  .object({
    version: z.literal(1),
    cadence: z.enum(["daily", "weekly"]),
    timeZone: z.string(),
    targetRunCount: z.number().int().min(1).max(SEO_MAX_MONITOR_RUNS),
    scopeVersion: z.number().int().nonnegative(),
    analysis: requestSeoAnalysisSchema,
  })
  .strict();

export function parseSeoMonitorPlan(description: string | null) {
  if (!description?.startsWith(SEO_MONITOR_MARKER)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(description.slice(SEO_MONITOR_MARKER.length));
  } catch {
    throw new Error("The SEO monitor blueprint is not valid JSON");
  }
  const parsed = seoMonitorPlanSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.analysis.kind === "audit_full" ||
    parsed.data.analysis.scopeId ||
    !parsed.data.analysis.pageIds?.length ||
    !parsed.data.analysis.coworkerId
  )
    throw new Error(
      "The SEO monitor blueprint is not a bounded public analysis",
    );
  return parsed.data;
}

export function isSeoMonitorDescription(description: string | null): boolean {
  return description?.startsWith(SEO_MONITOR_MARKER) ?? false;
}

export function seoMonitorDescriptionForUser(
  description: string | null,
): string | null {
  if (!isSeoMonitorDescription(description)) return description;
  try {
    const plan = parseSeoMonitorPlan(description)!;
    const checks = {
      page_check: "page checks",
      rankings: "ranking checks",
      links: "link checks",
      audit_lite: "selected SEO checks",
      audit_full: "SEO audits",
    } as const;
    const cadence = plan.cadence === "daily" ? "Daily" : "Weekly";
    const count = plan.analysis.pageIds?.length ?? 0;
    return `${cadence} ${checks[plan.analysis.kind]} for ${count} saved ${count === 1 ? "page" : "pages"}. Ends after ${plan.targetRunCount} scheduled runs. Time zone: ${plan.timeZone}.`;
  } catch {
    return "SEO monitor. Review its saved plan before the next scheduled run.";
  }
}
