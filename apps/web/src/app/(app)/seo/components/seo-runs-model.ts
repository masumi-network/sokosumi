import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

/** The checks that test the rules of a page: their issue count is the result of the run. */
const RULE_KINDS = new Set(["page_check", "audit_lite", "audit_full"]);
/** The newest days in the row. An older day shows only while it is the one in view. */
const SEO_RUN_DAYS = 5;

export interface SeoRunDay {
  /** The UTC day of the run: the day the period filter compares. */
  day: string;
  at: Date;
  /** Null where the checks of the day tested no page rules. */
  issues: number | null;
  /** The newest check of the day that tested page rules: the check the page shows when this day is picked. */
  check: string | null;
  selected: boolean;
  /** Inside a range of days the reader set: a range with a start marks no one run. */
  inRange: boolean;
  newest: boolean;
}

/**
 * The runs of the site as one entry per day, newest first, with the one in view marked.
 * The view of an older run is the period up to its day: the page then shows what was known on that day.
 */
export function seoRunDays(
  workspace: Pick<ProjectSeoWorkspace, "runs">,
  filters: { from: string | null; to: string | null },
) {
  const days = new Map<string, SeoRunDay>();
  /** Days whose newest rule check is known: an older check of the day says less about the page that day. */
  const counted = new Set<string>();
  // Core does not promise an order.
  const runs = (workspace.runs ?? [])
    .map((run) => ({ ...run, at: new Date(run.observedAt) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const run of runs) {
    const day = run.at.toISOString().slice(0, 10);
    const rule = RULE_KINDS.has(run.kind);
    if (!days.has(day))
      days.set(day, {
        day,
        at: run.at,
        issues: null,
        check: null,
        selected: false,
        inRange: false,
        newest: days.size === 0,
      });
    // The newest check of the day that tested rules gives the count, or none where it read only some pages.
    if (rule && !counted.has(day)) {
      counted.add(day);
      const entry = days.get(day)!;
      entry.issues = run.issues;
      entry.check = run.observationId;
    }
  }
  const all = [...days.values()];
  const { from, to } = filters;
  // A period with a start is a range of days, not the view of one run.
  const selected = from
    ? undefined
    : to
      ? all.find((entry) => entry.day <= to)
      : all[0];
  if (selected) selected.selected = true;
  if (from)
    for (const entry of all)
      entry.inRange = entry.day >= from && (!to || entry.day <= to);
  return {
    days: all.filter((entry, index) => index < SEO_RUN_DAYS || entry.selected),
    /** The end date is the pick of an older run, not a date the reader set in the date fields. */
    picked: Boolean(selected && !selected.newest && selected.day === to),
    /** Every day with a check, newest first: the calendar under "Other dates" marks them. */
    checkDays: all.map((entry) => entry.day),
  };
}

/** The row of runs shows with two entries at least: one run, with none in flight, is no choice. */
export function seoRunsRow(days: SeoRunDay[], running: boolean) {
  return days.length + (running ? 1 : 0) >= 2;
}

/**
 * The rule checks that the runs row opens, one per day it shows; none where the row shows no choice.
 * A pick of the day shows that check in the tiles, with its day, its tests and the link to its results.
 */
export function seoRunChecks(workspace: Pick<ProjectSeoWorkspace, "runs">) {
  const { days } = seoRunDays(workspace, { from: null, to: null });
  // A check of some of the pages has no count in the row: only its own History row says what it covered.
  return new Set(
    days.length < 2
      ? []
      : days.flatMap((entry) =>
          entry.check && entry.issues !== null ? [entry.check] : [],
        ),
  );
}

/** The runs row names the day of this rule check: it is the run in view, so a line with its date says it twice. */
export function seoRunsDateCheck(
  workspace: Pick<ProjectSeoWorkspace, "runs">,
  filters: { from: string | null; to: string | null },
  checkId: string | null,
) {
  const { days } = seoRunDays(workspace, filters);
  return (
    checkId !== null &&
    days.length > 1 &&
    days.find((entry) => entry.selected)?.check === checkId
  );
}
