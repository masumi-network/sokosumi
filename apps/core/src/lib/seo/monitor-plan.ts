import { z } from "@hono/zod-openapi";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { toLocalDateKey } from "@/helpers/task-schedule";
import {
  requestSeoAnalysisSchema,
  SEO_MAX_MONITOR_RUNS,
  seoIdSchema,
} from "@/schemas/project-seo.schema";
import {
  type SeoMonitorRule,
  seoMonitorRuleSchema,
} from "@/schemas/project-seo-monitor.schema";
import type { UpdateTaskScheduleRequest } from "@/schemas/task-schedule.schema";
import { seoMonitorRepeat } from "./monitor-cron";

export const SEO_MONITOR_MARKER = "seo_monitor: ";
/** The fixed 09:00 rules of packets saved before a monitor stored its own rule. */
const LEGACY_SEO_MONITOR_CRON = {
  daily: "0 9 * * *",
  weekly: "0 9 * * 1",
} as const;
const planFields = {
  scopeVersion: z.number().int().nonnegative(),
  analysis: requestSeoAnalysisSchema,
};
const legacyRuleFields = {
  cadence: z.enum(["daily", "weekly"]),
  timeZone: z.string(),
  targetRunCount: z.number().int().min(1).max(SEO_MAX_MONITOR_RUNS),
};
/** Version 1 belongs to a Project, version 2 to an Audit. */
function ownerVersions<T extends z.ZodRawShape>(fields: T) {
  return z.discriminatedUnion("version", [
    z.object({ version: z.literal(1), ...fields }).strict(),
    z
      .object({ version: z.literal(2), auditId: seoIdSchema, ...fields })
      .strict(),
  ]);
}
const seoMonitorPacketSchema = z.union([
  ownerVersions({ ...planFields, rule: seoMonitorRuleSchema }),
  ownerVersions({ ...planFields, ...legacyRuleFields }),
]);

export type SeoMonitorPlan = (
  | { version: 1 }
  | { version: 2; auditId: string }
) & {
  rule: SeoMonitorRule;
  scopeVersion: number;
  analysis: z.infer<typeof requestSeoAnalysisSchema>;
};

/** The approved plan, with the rule of an older packet read as it ran. */
export function parseSeoMonitorPlan(
  description: string | null,
): SeoMonitorPlan | null {
  if (!description?.startsWith(SEO_MONITOR_MARKER)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(description.slice(SEO_MONITOR_MARKER.length));
  } catch {
    throw new Error("The SEO monitor blueprint is not valid JSON");
  }
  const parsed = seoMonitorPacketSchema.safeParse(raw);
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
  const data = parsed.data;
  const owner =
    data.version === 2
      ? { version: 2 as const, auditId: data.auditId }
      : { version: 1 as const };
  const rule: SeoMonitorRule =
    "rule" in data
      ? data.rule
      : {
          expr: LEGACY_SEO_MONITOR_CRON[data.cadence],
          timezone: data.timeZone,
          endsMode: "AFTER",
          targetRunCount: data.targetRunCount,
        };
  return {
    ...owner,
    rule,
    scopeVersion: data.scopeVersion,
    analysis: data.analysis,
  };
}

/** The schedule description that stores an approved plan. */
export function seoMonitorDescription(plan: SeoMonitorPlan): string {
  return `${SEO_MONITOR_MARKER}${JSON.stringify(seoMonitorPacketSchema.parse(plan))}`;
}

/**
 * The description after an edit of an SEO monitor. An edit replaces the rule only: the pages, the check and its
 * allowance stay as a person approved them, and the rule must be one an SEO monitor may hold.
 */
export function seoMonitorDescriptionWithRule(
  description: string | null,
  {
    expectedRevision: _revision,
    rule,
    ...blueprint
  }: UpdateTaskScheduleRequest,
): string {
  if (!rule || Object.values(blueprint).some((value) => value !== undefined))
    throw conflict(
      "An SEO monitor edit changes only when it runs. Create a new monitor for other pages or checks.",
    );
  // The step goes to the schema as sent, so a step of 1 is refused here: the schedule's columns would keep it
  // while the packet could not, and every Run would then fail the release guard.
  const every = rule.intervalDays != null;
  const parsed = seoMonitorRuleSchema.safeParse({
    expr: rule.expr,
    timezone: rule.timezone,
    intervalDays: rule.intervalDays ?? null,
    anchorAt: every ? (rule.anchorAt ?? null) : null,
    endsMode: rule.endsMode,
    endsOn: rule.endsOn ?? null,
    targetRunCount: rule.targetRunCount ?? null,
  });
  if (!parsed.success)
    throw unprocessableEntity(
      parsed.error.issues[0]?.message ?? "Invalid SEO monitor rule",
    );
  let plan: SeoMonitorPlan | null;
  try {
    plan = parseSeoMonitorPlan(description);
  } catch (error) {
    throw conflict((error as Error).message);
  }
  if (!plan) throw conflict("This schedule is not an SEO monitor");
  return seoMonitorDescription({ ...plan, rule: parsed.data });
}

/** False only for an SEO monitor whose saved plan no longer parses: no Run may start from it. */
export function hasReadableSeoMonitorPlan(description: string | null): boolean {
  try {
    parseSeoMonitorPlan(description);
    return true;
  } catch {
    return false;
  }
}

export function isSeoMonitorDescription(description: string | null): boolean {
  return description?.startsWith(SEO_MONITOR_MARKER) ?? false;
}

/** The check and page count a client needs to write the plan sentence. Null for another schedule or a broken plan. */
export function seoMonitorSummary(
  description: string | null,
): { kind: SeoMonitorPlan["analysis"]["kind"]; pageCount: number } | null {
  try {
    const plan = parseSeoMonitorPlan(description);
    return plan
      ? {
          kind: plan.analysis.kind,
          pageCount: plan.analysis.pageIds?.length ?? 0,
        }
      : null;
  } catch {
    return null;
  }
}

/** English plan sentence for API readers. Web builds its own translated sentence from the rule. */
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
    const repeat = seoMonitorRepeat(plan.rule.expr);
    const cadence = plan.rule.intervalDays
      ? `Every ${plan.rule.intervalDays} days:`
      : repeat
        ? `${repeat[0]!.toUpperCase()}${repeat.slice(1)}`
        : "Scheduled";
    const count = plan.analysis.pageIds?.length ?? 0;
    const ends =
      plan.rule.targetRunCount !== null
        ? `Ends after ${plan.rule.targetRunCount} scheduled runs.`
        : plan.rule.endsOn
          ? `Ends on ${toLocalDateKey(new Date(plan.rule.endsOn), plan.rule.timezone)}.`
          : "Runs until someone stops it.";
    return `${cadence} ${checks[plan.analysis.kind]} for ${count} saved ${count === 1 ? "page" : "pages"}. ${ends} Time zone: ${plan.rule.timezone}.`;
  } catch {
    return "SEO monitor. Review its saved plan before the next scheduled run.";
  }
}
