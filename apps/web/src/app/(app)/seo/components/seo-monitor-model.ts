import type {
  ProjectSeoMonitor,
  ProjectSeoMonitorChange,
  ProjectSeoMonitorRule,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { DOW, type Dow, parseCron } from "@/lib/schedules/cron";
import {
  type ScheduleWhen,
  selectionToWhen,
  whenCron,
  whenToSelection,
} from "@/lib/schedules/schedule-when";
import { utcToDateTimeLocalInTimezone } from "@/lib/schedules/zoned-datetime";
import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import {
  selectionToTaskScheduleRule,
  taskScheduleRuleToSelection,
} from "@/lib/utils/task-schedule";
import {
  SEO_DEFAULT_MONITOR_RUNS,
  SEO_MAX_MONITOR_RUNS,
} from "./seo-form-model";

const MINUTE = /^[0-5]?\d$/;
const HOUR = /^([01]?\d|2[0-3])$/;
/** Core refuses a longer step. */
const SEO_MAX_MONITOR_INTERVAL_DAYS = 365;

/** Core's rule: a monitor runs at most once a day, at one time, since each Run is a paid check. */
export function seoMonitorOnceADay(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return (
    fields.length === 5 &&
    MINUTE.test(fields[0] ?? "") &&
    HOUR.test(fields[1] ?? "")
  );
}

/** Why no monitor can be made here. Null when one can. */
export type SeoMonitorBlock = "service" | "readOnly" | "noPages" | null;

export function seoMonitorBlock(
  workspace: Pick<ProjectSeoWorkspace, "availableActions" | "scope">,
): SeoMonitorBlock {
  if (!workspace.availableActions.canEdit) return "readOnly";
  if (workspace.availableActions.canCreateMonitor !== true) return "service";
  return workspace.scope.pageIds.length ? null : "noPages";
}

/** Scheduled Runs still to come. Null for a monitor with no run count: it runs until its end date or until someone stops it. */
export function seoMonitorRunsLeft(
  monitor: Pick<ProjectSeoMonitor, "rule" | "releasedCount" | "state">,
): number | null {
  if (monitor.state === "ENDED") return 0;
  if (monitor.rule.targetRunCount === null) return null;
  return Math.max(0, monitor.rule.targetRunCount - monitor.releasedCount);
}

/** The monitor checks the pages it froze. True when the selected page group now holds other pages. */
export function seoMonitorPagesDiffer(
  monitor: Pick<ProjectSeoMonitor, "pageIds">,
  scopePageIds: readonly string[],
): boolean {
  const frozen = new Set(monitor.pageIds);
  return (
    frozen.size !== new Set(scopePageIds).size ||
    scopePageIds.some((id) => !frozen.has(id))
  );
}

export type SeoMonitorChangeSummary =
  | { kind: "none" }
  | { kind: "notComparable" }
  | { kind: "same" }
  | {
      kind: "changed";
      newFailures: number;
      fixed: number;
      drops: number;
      rises: number;
    };

export function seoMonitorChangeSummary(
  change: ProjectSeoMonitorChange | null,
): SeoMonitorChangeSummary {
  if (!change) return { kind: "none" };
  if (!change.comparable) return { kind: "notComparable" };
  const rises = change.moveCount - change.dropCount;
  if (!change.newFailureCount && !change.fixedCount && !change.moveCount)
    return { kind: "same" };
  return {
    kind: "changed",
    newFailures: change.newFailureCount,
    fixed: change.fixedCount,
    drops: change.dropCount,
    rises,
  };
}

/** How a rule reads in a sentence: its repeat and the values the sentence names. */
export type SeoMonitorPlan =
  | { repeat: "daily"; hour: number; minute: number }
  | { repeat: "interval"; days: number; hour: number; minute: number }
  | { repeat: "weekly"; hour: number; minute: number; weekdays: Dow[] }
  | { repeat: "monthly"; hour: number; minute: number; dayOfMonth: number }
  | { repeat: "other" };

export function seoMonitorPlan(
  rule: Pick<ProjectSeoMonitorRule, "expr"> &
    Partial<
      Pick<ProjectSeoMonitorRule, "intervalDays" | "anchorAt" | "timezone">
    >,
): SeoMonitorPlan {
  // Every N days runs at its anchor's local time; the cron's day fields are unused.
  if (rule.intervalDays != null && rule.intervalDays > 1 && rule.anchorAt) {
    const local = utcToDateTimeLocalInTimezone(
      new Date(rule.anchorAt),
      rule.timezone ?? "UTC",
    );
    return {
      repeat: "interval",
      days: rule.intervalDays,
      hour: Number(local.slice(11, 13)),
      minute: Number(local.slice(14, 16)),
    };
  }
  const parsed = parseCron(rule.expr);
  switch (parsed.kind) {
    case "dailyAtTime":
      return { repeat: "daily", hour: parsed.hour, minute: parsed.minute };
    case "weeklyAtTime":
      return {
        repeat: "weekly",
        hour: parsed.hour,
        minute: parsed.minute,
        // Monday first, the way the editor shows the week.
        weekdays: [...DOW.slice(1), DOW[0]].filter((day) =>
          parsed.dows.includes(day),
        ),
      };
    case "monthlyOnDay":
      return {
        repeat: "monthly",
        hour: parsed.hour,
        minute: parsed.minute,
        dayOfMonth: parsed.dayOfMonth,
      };
    default:
      return { repeat: "other" };
  }
}

/** A new schedule starts weekly on Mondays at 09:00, for a few Runs: each Run is a paid check. */
const SEO_MONITOR_START_CRON = "0 9 * * MON";

/** The editor state of a stored rule, or of a new monitor when there is none. */
export function seoMonitorWhen(
  rule: ProjectSeoMonitorRule | null,
  timezone: string,
  now = new Date(),
): ScheduleWhen {
  return selectionToWhen(
    rule
      ? {
          ...taskScheduleRuleToSelection({
            ...rule,
            intervalDays: rule.intervalDays ?? null,
            // A Task Schedule always has an anchor; only an every-N-days rule reads it, and that rule carries one.
            anchorAt: rule.anchorAt ?? new Date(0),
            endsOn: rule.endsOn ?? null,
          }),
          endAfterOccurrences: rule.targetRunCount ?? SEO_DEFAULT_MONITOR_RUNS,
        }
      : {
          timezone,
          cron: SEO_MONITOR_START_CRON,
          endsMode: TaskScheduleEndsMode.AFTER,
          endAfterOccurrences: SEO_DEFAULT_MONITOR_RUNS,
        },
    now,
  );
}

/** True when the editor holds a cron that runs more than once a day: the form says why it cannot save. */
export function seoMonitorTooOften(when: ScheduleWhen): boolean {
  const expr = whenCron(when);
  return expr !== null && !seoMonitorOnceADay(expr);
}

/** The rule an editor state saves, or null while it is incomplete or one Core would refuse. */
export function seoMonitorRuleOf(
  when: ScheduleWhen,
): ProjectSeoMonitorRule | null {
  const rule = selectionToTaskScheduleRule(whenToSelection(when));
  if (
    !rule ||
    !seoMonitorOnceADay(rule.expr) ||
    (rule.intervalDays ?? 0) > SEO_MAX_MONITOR_INTERVAL_DAYS
  )
    return null;
  const count = rule.targetRunCount ?? null;
  if (
    rule.endsMode === "AFTER" &&
    (count === null || count > SEO_MAX_MONITOR_RUNS)
  )
    return null;
  return {
    expr: rule.expr,
    timezone: rule.timezone,
    intervalDays: rule.intervalDays ?? null,
    anchorAt: rule.anchorAt ?? null,
    endsMode: rule.endsMode ?? "NEVER",
    endsOn: rule.endsOn ?? null,
    targetRunCount: count,
  };
}

/** An edit may not end a monitor before the Runs it already made. */
export function seoMonitorRuleBelowReleased(
  rule: ProjectSeoMonitorRule,
  releasedCount: number,
): boolean {
  return rule.targetRunCount !== null && rule.targetRunCount <= releasedCount;
}
