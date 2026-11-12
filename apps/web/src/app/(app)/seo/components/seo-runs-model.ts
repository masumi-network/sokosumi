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
  selected: boolean;
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
  // Core does not promise an order.
  const runs = (workspace.runs ?? [])
    .map((run) => ({ ...run, at: new Date(run.observedAt) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const run of runs) {
    const day = run.at.toISOString().slice(0, 10);
    const issues = RULE_KINDS.has(run.kind) ? run.issues : null;
    const known = days.get(day);
    if (!known)
      days.set(day, {
        day,
        at: run.at,
        issues,
        selected: false,
        newest: days.size === 0,
      });
    // The newest check of the day that tested rules gives the count.
    else if (known.issues === null) known.issues = issues;
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
  return {
    days: all.filter((entry, index) => index < SEO_RUN_DAYS || entry.selected),
    /** The end date is the pick of an older run, not a date the reader set in the date fields. */
    picked: Boolean(selected && !selected.newest && selected.day === to),
  };
}
