import type {
  ProjectSeoAction,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import {
  SEO_ISSUE_SEVERITY_NAMES,
  type SeoIssueSeverity,
} from "./seo-overview-model";

type Report = ProjectSeoWorkspace["observations"][number];
type Status = ProjectSeoAction["status"];

/** An action the reader still has to decide on. */
const WAITING: ReadonlySet<Status> = new Set(["recommended", "needs_review"]);
/** An action whose change is on the page. */
const DONE: ReadonlySet<Status> = new Set(["implemented", "verified"]);

/**
 * The plan the SEO worker wrote for a report, with the actions of the same report each step stands for. Null for a
 * report without a written plan: a plan needs its summary to read as one text.
 */
export function seoPlanMessage(
  workspace: Pick<ProjectSeoWorkspace, "actions">,
  report: Report | undefined,
  severity: (action: ProjectSeoAction) => SeoIssueSeverity | null,
) {
  const plan = report?.auditPlan;
  if (!report || !plan?.summary) return null;
  const linked = new Set<ProjectSeoAction>();
  const steps = plan.steps.map((step) => {
    // A later check can replace an action. Its step then stays as text.
    const actions = step.actionIds.flatMap(
      (id) =>
        workspace.actions.find(
          (action) => action.observationId === report.id && action.id === id,
        ) ?? [],
    );
    for (const action of actions) linked.add(action);
    const severities = new Set(actions.map(severity));
    return {
      ...step,
      actions,
      // The worst issue an action of the step fixes.
      severity:
        SEO_ISSUE_SEVERITY_NAMES.find((name) => severities.has(name)) ?? null,
      state:
        actions.length && actions.every((action) => DONE.has(action.status))
          ? ("done" as const)
          : actions.some((action) => action.status === "task_created")
            ? ("started" as const)
            : ("open" as const),
    };
  });
  return {
    summary: plan.summary,
    strategy: plan.strategy,
    alternative: plan.alternative,
    revisit: plan.revisit,
    steps,
    /** The actions that wait for the reader and that no step names. */
    rest: workspace.actions.filter(
      (action) => WAITING.has(action.status) && !linked.has(action),
    ).length,
  };
}
export type SeoPlanMessageModel = NonNullable<
  ReturnType<typeof seoPlanMessage>
>;

// Keep whole sentences together, especially two measurements that explain one discrepancy.
const PLAN_LEAD_CHARACTERS = 180;
const sentenceSegments = new Intl.Segmenter("en", { granularity: "sentence" });

export function seoPlanExcerpt(text: string) {
  const full = text.trim();
  if (full.length <= PLAN_LEAD_CHARACTERS) return { lead: full, rest: "" };
  let end = 0;
  for (const { index, segment } of sentenceSegments.segment(full)) {
    const next = index + segment.length;
    if (next > PLAN_LEAD_CHARACTERS) break;
    end = next;
  }
  return {
    lead: full.slice(0, end).trimEnd(),
    rest: full.slice(end).trimStart(),
  };
}
