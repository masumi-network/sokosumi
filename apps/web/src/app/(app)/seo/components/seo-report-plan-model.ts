import type { ProjectSeoWorkspace, SeoAuditBrief } from "@sokosumi/core-client";
import {
  allowsSeoCompletionEvent,
  seoCompletionEvent,
  seoSeasonalTiming,
} from "@sokosumi/utils";
import { earlierPlanReports, reportHypotheses } from "./seo-report-history";

type Workspace = ProjectSeoWorkspace;
type Report = Workspace["observations"][number];
type Candidate = NonNullable<Report["planCandidates"]>[number];
type Goal = SeoAuditBrief["pages"][number];
type Objective = SeoAuditBrief["objective"];
const salesActions = new Set<Goal["action"]>([
  "buy",
  "book",
  "contact sales",
  "call",
  "sign up",
  "subscribe",
]);
const isContent = (row: Candidate) =>
  row.kind === "content" ||
  row.kind === "experiment" ||
  row.kind === "internal_link";
const isSalesPage = (goal?: Goal) =>
  !!goal &&
  (salesActions.has(goal.action) ||
    goal.role === "pricing" ||
    goal.role === "product");

const priorities = [
  "access",
  "goalPath",
  "checkTracking",
  "handoff",
  "checkIntent",
  "majorFix",
  "support",
  "traffic",
  "salesPage",
  "experiment",
  "fix",
] as const;
type Basis = (typeof priorities)[number];

function priority(
  candidate: Candidate,
  objective: Objective,
  goals: Map<string, Goal>,
): Basis {
  const goal = goals.get(candidate.pageUrl);
  if (candidate.kind === "access" && candidate.severity === "critical")
    return "access";
  const destinationGoal = candidate.destinations?.some((url) =>
    isSalesPage(goals.get(url)),
  );
  if (
    objective === "sales" &&
    ((candidate.kind === "broken_link" && destinationGoal) ||
      candidate.kind === "completion")
  )
    return "goalPath";
  if (candidate.severity === "critical") return "majorFix";
  if (
    objective === "support" &&
    (goal?.role === "support" || goal?.role === "guide") &&
    (candidate.kind === "broken_link" || isContent(candidate))
  )
    return "support";
  if (objective === "traffic" && isContent(candidate)) return "traffic";
  if (candidate.severity === "major" || candidate.kind === "access")
    return "majorFix";
  if (objective === "sales" && isSalesPage(goal)) return "salesPage";
  return isContent(candidate) ? "experiment" : "fix";
}

export function seoPlanReports(data: Workspace) {
  return data.observations
    .filter((r) => r.planCandidates !== undefined)
    .toSorted(
      (a, b) =>
        +new Date(b.observedAt) - +new Date(a.observedAt) ||
        a.id.localeCompare(b.id),
    );
}

export function seoReportPlan(
  data: Workspace,
  report: Report,
  brief: SeoAuditBrief | undefined,
  historical: boolean,
  now: Date,
) {
  const goals = new Map<string, Goal>();
  for (const goal of brief?.pages ?? []) {
    const page = data.pages.find((row) => row.id === goal.pageId);
    if (page) goals.set(page.url, goal);
  }
  const objective = brief?.objective ?? null;
  const search = report.sourceTaskId
    ? data.auditSearchConsole?.find((row) => row.taskId === report.sourceTaskId)
    : undefined;
  const scopedPages = new Set(
    data.pages
      .filter(
        (page) =>
          report.pageIds.includes(page.id) &&
          data.scope.pageIds.includes(page.id),
      )
      .map((page) => page.url),
  );
  const context = reportHypotheses(
    data,
    report,
    historical ? new Date(report.observedAt) : now,
  );
  const candidates: Candidate[] = context.candidates;
  for (const opportunity of search?.opportunities ?? []) {
    if (
      !scopedPages.has(opportunity.pageUrl) ||
      candidates.some((item) => item.actionId === opportunity.id)
    )
      continue;
    candidates.push({
      kind: "content",
      pageUrl: opportunity.pageUrl,
      actionId: opportunity.id,
      title: opportunity.title,
      reason: opportunity.why,
      evidence: opportunity.evidence,
      nextCheck: opportunity.expectedEffect,
    });
  }
  if (!historical && objective === "sales")
    for (const [pageUrl, goal] of goals) {
      if (
        !scopedPages.has(pageUrl) ||
        candidates.some((c) => c.pageUrl === pageUrl)
      )
        continue;
      const control = brief?.followUps.find(
        (f) => f.pageId === goal.pageId,
      )?.goalInvestigation;
      if (
        control &&
        control.pageUrl === pageUrl &&
        control.event === seoCompletionEvent(goal) &&
        control.assessment !== "goal_held"
      ) {
        candidates.push({
          kind: "experiment",
          pageUrl,
          title: `Review how visitors complete “${goal.action}” on this page.`,
          reason:
            "The private goal comparison covers organic and direct sessions on this landing page.",
          evidence: [],
        });
      }
    }
  const available = candidates.filter((row) => {
    if (
      goals.get(row.pageUrl)?.indexIntent === "exclude" &&
      (row.kind === "access" || isContent(row))
    )
      return false;
    if (historical) return true;
    if (
      row.season &&
      seoSeasonalTiming(
        {
          country: row.season.country,
          event: { date: row.season.through },
          windows: [],
        },
        now,
      ).passed
    )
      return false;
    const action =
      row.actionId &&
      data.actions.find(
        (a) =>
          a.id === row.actionId &&
          (a.observationId === report.id ||
            context.origin.get(row)?.id === a.observationId),
      );
    return (
      !action ||
      action.status === "recommended" ||
      action.status === "needs_review"
    );
  });
  const evaluationFor = (item: Candidate) => {
    if (historical || objective !== "sales") return;
    const goal = goals.get(item.pageUrl);
    const follow = brief?.followUps.find((f) => f.pageId === goal?.pageId);
    const evaluation = follow?.goalInvestigation;
    if (
      evaluation &&
      follow?.latestClosedGoal &&
      follow.latestClosedGoal.to > evaluation.after.to
    )
      return;
    return evaluation?.pageUrl === item.pageUrl &&
      evaluation.event === seoCompletionEvent(goal)
      ? evaluation
      : undefined;
  };
  const measuredPages = new Map(
    search?.pageDiscovery?.topClickedPages?.map((row) => [row.pageUrl, row]),
  );
  const ordered = available
    .map((item) => {
      let basis = priority(item, objective, goals);
      const control = evaluationFor(item);
      if (
        basis !== "access" &&
        basis !== "goalPath" &&
        item.severity !== "critical"
      ) {
        if (control?.assessment === "both_declined") basis = "checkTracking";
        if (control?.assessment === "handoff") basis = "handoff";
        if (control?.assessment === "organic_declined") basis = "checkIntent";
      }
      return {
        item,
        basis,
        control,
        ...context.assess(item),
        impressions: measuredPages.get(item.pageUrl)?.impressions,
      };
    })
    .sort(
      (a, b) =>
        priorities.indexOf(a.basis) - priorities.indexOf(b.basis) ||
        b.strength - a.strength ||
        (a.basis === "traffic"
          ? (b.impressions ?? 0) - (a.impressions ?? 0)
          : 0),
    );
  const first = ordered[0];
  if (!first) return null;
  const { item: lead, basis, control } = first;
  const reconsider =
    basis === "checkTracking" || basis === "checkIntent" || basis === "handoff";
  const related = (row: Candidate) =>
    row.pageUrl === lead.pageUrl || lead.destinations?.includes(row.pageUrl);
  // Promotion can follow a repair on this route. A shared topic alone establishes no dependency.
  const follow =
    !reconsider && ["access", "completion", "broken_link"].includes(lead.kind)
      ? ordered.slice(1).find(({ item }) => related(item) && isContent(item))
          ?.item
      : undefined;
  const runnerUp = reconsider
    ? { item: lead, basis: priority(lead, objective, goals) }
    : ordered
        .slice(1)
        .find(({ item }) => item !== follow && item.title !== lead.title);
  const destination =
    basis === "goalPath" &&
    lead.destinations?.find((url) => isSalesPage(goals.get(url)));
  const goal = goals.get(destination || lead.pageUrl);
  const compareOrder = !runnerUp && Boolean(follow);
  const review =
    !historical && lead.actionId
      ? data.actions.find(
          (action) =>
            action.id === lead.actionId &&
            (action.observationId === report.id ||
              action.followUpReview?.observationId === report.id),
        )?.followUpReview
      : undefined;
  return {
    lead,
    sources: first.sources,
    corroboration: first.corroboration,
    timing: first.timing,
    strength: first.strength,
    originId: first.originId,
    eventName: goal?.completionEvent,
    detectedName: seoCompletionEvent(goal),
    missingOutcome:
      !historical &&
      objective === "sales" &&
      allowsSeoCompletionEvent(goal?.action) &&
      !control
        ? goal?.action
        : undefined,
    basis,
    follow,
    runnerUp,
    objective,
    control,
    review,
    goal,
    reconsider,
    destination,
    exposure:
      search &&
      basis === "traffic" &&
      first.strength === ordered[1]?.strength &&
      first.impressions &&
      ordered[1]?.basis === "traffic" &&
      first.impressions > (ordered[1].impressions ?? 0)
        ? { impressions: first.impressions, from: search.from, to: search.to }
        : undefined,
    compareOrder,
  };
}

export function seoPlanChange(
  data: Workspace,
  report: Report,
  brief: SeoAuditBrief | undefined,
  plan: ReturnType<typeof seoReportPlan>,
) {
  if (!plan) return;
  const page = data.pages.find((p) => p.url === plan.lead.pageUrl);
  const prior = earlierPlanReports(data, report).find(
    (r) =>
      page &&
      r.pageIds.includes(page.id) &&
      (r.kind === report.kind ||
        plan.sources.some((s) => s.reportId === r.id)) &&
      r.planCandidates?.length,
  );
  if (!prior) return;
  const before = seoReportPlan(
    data,
    prior,
    brief,
    true,
    new Date(prior.observedAt),
  );
  if (
    !before ||
    !data.pages.some(
      (p) => p.url === before.lead.pageUrl && report.pageIds.includes(p.id),
    )
  )
    return;
  const sameAction =
    before.lead.pageUrl === plan.lead.pageUrl &&
    (before.lead.actionId && plan.lead.actionId
      ? before.lead.actionId === plan.lead.actionId
      : before.lead.title === plan.lead.title);
  const changed =
    (!sameAction &&
      (plan.lead.pageUrl !== before.lead.pageUrl ||
        plan.lead.kind !== before.lead.kind ||
        plan.lead.evidence.some(
          (line) => !before.lead.evidence.includes(line),
        ) ||
        (plan.lead.actionId &&
          before.lead.actionId &&
          plan.lead.actionId !== before.lead.actionId))) ||
    before.basis !== plan.basis ||
    before.timing?.month !== plan.timing?.month ||
    (!before.timing?.due && plan.timing?.due);
  if (!changed) return;
  return { reportId: prior.id, previous: before.lead.title };
}
