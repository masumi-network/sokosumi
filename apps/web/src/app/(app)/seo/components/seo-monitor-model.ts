import type {
  ProjectSeoMonitor,
  ProjectSeoMonitorChange,
  ProjectSeoMonitorRule,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { DOW, type Dow, parseCron } from "@/lib/schedules/cron";
import {
  type ScheduleRepeat,
  type ScheduleWhen,
  selectionToWhen,
  whenCron,
} from "@/lib/schedules/schedule-when";
import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import {
  SEO_DEFAULT_MONITOR_RUNS,
  SEO_MAX_MONITOR_RUNS,
} from "./seo-form-model";

/** The repeats an SEO monitor may hold. Core refuses any other rule. */
export const SEO_MONITOR_REPEATS: readonly ScheduleRepeat[] = [
  "daily",
  "weekly",
  "monthly",
];
export const SEO_MONITOR_ENDS: readonly TaskScheduleEndsMode[] = [
  TaskScheduleEndsMode.NEVER,
  TaskScheduleEndsMode.AFTER,
];

/** Why no monitor can be made here. Null when one can. */
export type SeoMonitorBlock = "service" | "readOnly" | "noPages" | null;

export function seoMonitorBlock(
  workspace: Pick<ProjectSeoWorkspace, "availableActions" | "scope">,
): SeoMonitorBlock {
  if (!workspace.availableActions.canEdit) return "readOnly";
  if (workspace.availableActions.canCreateMonitor !== true) return "service";
  return workspace.scope.pageIds.length ? null : "noPages";
}

/**
 * The card with no monitor stays hidden only when a notice of the page already gives its reason: a reader who can
 * only view, or a workspace where no check can start. One notice says it once.
 */
export function seoMonitorCardHidden(
  workspace: Pick<
    ProjectSeoWorkspace,
    "availableActions" | "scope" | "monitors"
  >,
): boolean {
  if (workspace.monitors.length) return false;
  const block = seoMonitorBlock(workspace);
  return (
    block === "readOnly" ||
    (block === "service" && !workspace.availableActions.canRequestAnalysis)
  );
}

/** Scheduled Runs still to come. Null for a monitor that runs until someone stops it. */
export function seoMonitorRunsLeft(
  monitor: Pick<ProjectSeoMonitor, "rule" | "releasedCount" | "state">,
): number | null {
  if (monitor.rule.targetRunCount === null) return null;
  if (monitor.state === "ENDED") return 0;
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
  | { repeat: "weekly"; hour: number; minute: number; weekdays: Dow[] }
  | { repeat: "monthly"; hour: number; minute: number; dayOfMonth: number }
  | { repeat: "other" };

export function seoMonitorPlan(
  rule: Pick<ProjectSeoMonitorRule, "expr">,
): SeoMonitorPlan {
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

/** The editor state of a stored rule, or of a new monitor when there is none. */
export function seoMonitorWhen(
  rule: ProjectSeoMonitorRule | null,
  timezone: string,
  now = new Date(),
): ScheduleWhen {
  const when = selectionToWhen(
    rule
      ? {
          timezone: rule.timezone,
          cron: rule.expr,
          // Core writes the end mode in capitals; the editor holds its own lowercase values.
          endsMode:
            rule.endsMode === "NEVER"
              ? TaskScheduleEndsMode.NEVER
              : TaskScheduleEndsMode.AFTER,
          endAfterOccurrences: rule.targetRunCount ?? SEO_DEFAULT_MONITOR_RUNS,
        }
      : {
          timezone,
          cron: "0 9 * * MON",
          endsMode: TaskScheduleEndsMode.AFTER,
          endAfterOccurrences: SEO_DEFAULT_MONITOR_RUNS,
        },
    now,
  );
  // The SEO editor has no "weekdays" choice: Monday to Friday is a weekly rule with five days.
  return when.repeat === "weekdays"
    ? {
        ...when,
        repeat: "weekly",
        weekdays: ["MON", "TUE", "WED", "THU", "FRI"],
      }
    : when;
}

/** The rule an editor state saves, or null while it is incomplete or one Core would refuse. */
export function seoMonitorRuleOf(
  when: ScheduleWhen,
): ProjectSeoMonitorRule | null {
  if (!SEO_MONITOR_REPEATS.includes(when.repeat)) return null;
  const expr = whenCron(when);
  if (!expr) return null;
  if (when.endsMode === TaskScheduleEndsMode.NEVER)
    return {
      expr,
      timezone: when.timezone,
      endsMode: "NEVER",
      targetRunCount: null,
    };
  const count = when.endAfterOccurrences;
  if (
    when.endsMode !== TaskScheduleEndsMode.AFTER ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > SEO_MAX_MONITOR_RUNS
  )
    return null;
  return {
    expr,
    timezone: when.timezone,
    endsMode: "AFTER",
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
