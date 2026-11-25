import type {
  ProjectSeoActionTask,
  ProjectSeoAnalysis,
  ProjectSeoCompetitor,
  ProjectSeoKeyword,
  ProjectSeoObservation,
  ProjectSeoPage,
  ProjectSeoScope,
} from "@sokosumi/database";
import { seoIssueKey } from "@sokosumi/utils";
import { internalServerError } from "@/helpers/error";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import { scopedObservationChecks } from "@/helpers/seo-checklist-breakdown";
import { observationPageSpeed } from "@/helpers/seo-page-speed";
import { scopedReportEvidence } from "@/helpers/seo-report-plan";
import { scopedSiteSpeed } from "@/helpers/seo-site-speed";
import {
  type ProjectSeoWorkspace,
  projectSeoWorkspaceSchema,
  type SeoIndexedPage,
  type SeoWorkspaceQuery,
  saveSeoKeywordSchema,
  seoPageChangePayloadSchema,
} from "@/schemas/project-seo.schema";
import { applySeoActionTaskVisibility } from "./project-seo-action-task-visibility";
import {
  actionVerifiedAt,
  latestDate,
} from "./project-seo-action-verification";
import {
  checkIdentity,
  issueIdentity,
  SEO_ISSUE_SEVERITIES,
} from "./project-seo-check-identity";
import {
  indexAuditFindings,
  newestIndexStatus,
  withIndexIssueCounts,
} from "./project-seo-index-projection";
import {
  observedSeoKeyword,
  savedSeoKeyword,
  seoKeywordIdentity,
} from "./project-seo-keyword-rows";
import {
  projectSeoMetricsRow,
  type SeoMetricsProjection,
} from "./project-seo-metrics-projection";
import {
  projectSearchEvidence,
  type SearchEvidenceSource,
} from "./project-seo-search-projection";
import { projectSiteEvidence } from "./project-seo-site-evidence";
import {
  canConfirmSeoCompetitor,
  matchesSeoPeriod,
  normalizeSeoUrl,
  SEO_RESULT_LIMIT,
} from "./project-seo-store";
import { projectSiteStrategy } from "./project-seo-strategy-projection";
import { SeoAuditDecisions } from "./seo-audit-decisions";
import { landingEngagementChange } from "./seo-landing-engagement";
import type { PrivateRecommendationReviews } from "./seo-private-recommendation-reviews";
import {
  type DecisionObservation,
  projectSeoReviewHistory,
} from "./seo-recommendation-history";

interface ProjectionInput {
  sharing?: "organization" | "personal";
  project: {
    id: string;
    auditId?: string | null;
    projectId?: string | null;
    name?: string | null;
    websiteUrl: string | null;
    closingAt: Date | null;
    closedAt: Date | null;
  };
  query: SeoWorkspaceQuery;
  scope: {
    id: string | null;
    name: string;
    version: number;
    pageIds: string[];
    pages: ProjectSeoPage[];
  };
  pages: ProjectSeoPage[];
  scopes: ProjectSeoScope[];
  observations: ProjectSeoObservation[];
  reviewHistory?: DecisionObservation[];
  privateReviews?: PrivateRecommendationReviews;
  /** True when the evidence or the metrics load reached its own row cap. */
  historyLimited: boolean;
  /** True when the evidence load (checks and page changes) reached its row cap: an older check can be cut. */
  evidenceLimited: boolean;
  keywords: ProjectSeoKeyword[];
  competitors: ProjectSeoCompetitor[];
  analyses: ProjectSeoAnalysis[];
  actionTasks: ProjectSeoActionTask[];
  tasks: Array<{ id: string; status: string; completedAt: Date | null }>;
  marketRecoveryTaskIds?: ReadonlySet<string>;
  privateMetricsAllowed: boolean;
  analysisDispatchEnabled?: boolean;
  canUsePaidSearchData?: boolean;
  canSchedule?: boolean;
  monitors?: ProjectSeoWorkspace["monitors"];
}
const key = (...parts: Array<string | null>) => JSON.stringify(parts);
/** A Task in one of these states does no work on its action any more. */
const DEAD_TASK_STATUSES = new Set(["FAILED", "CANCELED"]);

/** Current views are projections. Historical observations and human choices remain separate. */
export function projectSeoProjection(
  input: ProjectionInput,
  now = new Date(),
): ProjectSeoWorkspace {
  const { project, scope, query } = input;
  const selectedIds = new Set(scope.pageIds),
    selectedUrls = new Set(scope.pages.map((page) => page.url));
  const overlaps = (ids: string[]) => ids.some((id) => selectedIds.has(id));
  const findings: ProjectSeoWorkspace["findings"] = [],
    keywords: ProjectSeoWorkspace["keywords"] = [],
    competitors: ProjectSeoWorkspace["competitors"] = [],
    actions: ProjectSeoWorkspace["actions"] = [],
    metrics: ProjectSeoWorkspace["metrics"] = [],
    timeline: ProjectSeoWorkspace["timeline"] = [],
    runs: NonNullable<ProjectSeoWorkspace["runs"]> = [],
    observations: ProjectSeoWorkspace["observations"] = [];
  const seenKeywords = new Set<string>(),
    seenCompetitors = new Set<string>(),
    seenFindings = new Map<string, string>(),
    seenMetricGroups = new Set<string>();
  /** The findings that an action of a later check fixes. Rows come newest first. */
  const proposed = new Set<string>();
  /** Per fix action: the findings it fixes as one key, the time of its check, and whether a Task still works on it. */
  const fixWork = new Map<
    ProjectSeoWorkspace["actions"][number],
    { work: string; observedAt: Date; live: boolean }
  >();
  const incompleteRuns = new Set<string>();
  const latestChecked = new Map<
    string,
    { id: string; result: "pass" | "fired"; observedAt: Date }
  >();
  const keywordChoices = new Map(
    input.keywords.map((row) => [
      key(row.keywordKey, row.countryCode, row.languageCode),
      row,
    ]),
  );
  const observedKeywordChoices = new Set<string>();
  const competitorChoices = new Map(
    input.competitors.map((row) => [row.url, row]),
  );
  const taskStatuses = new Map(
    input.tasks.map((task) => [task.id, task.status]),
  );
  const actionTasks = input.actionTasks.filter((link) =>
    taskStatuses.has(link.taskId),
  );
  const scopedPublicSources = new Map<string, ProjectSeoObservation>();
  let strategy: ProjectSeoWorkspace["strategy"] = null;
  let siteSpeed: ProjectSeoWorkspace["siteSpeed"];
  const decisions = new SeoAuditDecisions(
    selectedUrls,
    actionTasks,
    taskStatuses,
    now,
    input.tasks,
    input.privateReviews,
  );
  projectSeoReviewHistory(decisions, input, selectedIds);
  const searchSources: SearchEvidenceSource[] = [];
  const indexSources: Array<{ at: Date; pages: SeoIndexedPage[] }> = [];
  const metricRows: SeoMetricsProjection = {
    metrics,
    collections: new Map(),
    searchSources,
    indexSources,
    seenGroups: seenMetricGroups,
    landingPages: null,
    landingSources: [],
  };
  for (const row of input.observations) {
    if (!overlaps(row.pageIds)) continue;
    if (
      ["index_triage", "index_inspection", "site_evidence"].includes(row.kind)
    )
      continue;
    if (row.kind === "page_change") {
      if (!matchesSeoPeriod(row.observedAt, query)) continue;
      const event = seoPageChangePayloadSchema.parse(row.payload);
      timeline.push({
        id: `page-change:${row.id}`,
        kind: "page_change",
        title: event.title,
        at: event.occurredAt,
        pageIds: row.pageIds,
        observationId: null,
        taskId: null,
        status: "recorded",
        detail: event.note,
      });
      continue;
    }
    if (row.kind === "metrics") {
      if (input.privateMetricsAllowed)
        projectSeoMetricsRow(row, query, selectedUrls, metricRows);
      continue;
    }
    const parsed = publicSeoPayloadSchema.safeParse(row.payload);
    if (!parsed.success)
      throw internalServerError("Stored SEO evidence is not readable");
    const data = parsed.data;
    const { coverage, checklistBreakdown, devices } = scopedObservationChecks(
      data,
      (url) => selectedUrls.has(normalizeSeoUrl(url)),
    );
    scopedPublicSources.set(row.id, row);
    if (!coverage.checked || coverage.failed || coverage.modules?.failed)
      incompleteRuns.add(row.id);
    // One rule that fails on mobile and on desktop is one issue on that page.
    const issues = new Set(
      data.findings
        .filter(
          (item) =>
            SEO_ISSUE_SEVERITIES.has(item.severity) &&
            selectedUrls.has(normalizeSeoUrl(item.pageUrl)),
        )
        .map((item) => seoIssueKey({ observationId: row.id, ...item })),
    ).size;
    const request = row.sourceTaskId
      ? input.analyses.find((item) => item.taskId === row.sourceTaskId)
      : undefined;
    runs.push({
      observationId: row.id,
      kind: row.kind,
      observedAt: row.observedAt.toISOString(),
      // A count of some pages is no result of the selection: the page would show more issues for that day.
      issues: [...selectedIds].every((id) => row.pageIds.includes(id))
        ? issues
        : null,
      seconds: request
        ? Math.max(
            0,
            Math.round(
              (row.createdAt.getTime() - request.createdAt.getTime()) / 1000,
            ),
          )
        : null,
    });
    timeline.push({
      id: `observation:${row.id}`,
      kind: row.kind === "audit_full" ? "audit" : "check",
      title:
        row.kind === "audit_full"
          ? "SEO audit imported"
          : "SEO check results imported",
      at: row.createdAt.toISOString(),
      pageIds: row.pageIds,
      observationId: row.id,
      taskId: row.sourceTaskId,
      status:
        coverage.failed || coverage.modules?.failed ? "partial" : "completed",
      detail:
        `Rule checks: ${coverage.checked} checked, ${coverage.skipped} not checked, ${coverage.failed} unavailable.` +
        (coverage.modules
          ? ` Analysis types: ${coverage.modules.notRequested} not requested, ${coverage.modules.failed} unavailable.`
          : ""),
    });
    if (!matchesSeoPeriod(row.observedAt, query)) continue;
    if (data.siteSpeed && siteSpeed === undefined)
      siteSpeed = scopedSiteSpeed(data, row, selectedUrls);
    // Rows come newest first, so the first strategy is the newest site audit's.
    if (data.strategy && !strategy) {
      const recover =
        row.sourceTaskId && input.marketRecoveryTaskIds?.has(row.sourceTaskId);
      strategy = projectSiteStrategy(
        data.strategy,
        data,
        row,
        selectedUrls,
        recover ? row.sourceFileId : null,
      );
    }
    observations.push({
      id: row.id,
      kind: row.kind,
      source: row.source,
      observedAt: row.observedAt.toISOString(),
      pageIds: row.pageIds,
      scopeVersion: row.scopeVersion,
      sourceTaskId: row.sourceTaskId,
      countryCode: data.countryCode || null,
      languageCode: data.languageCode || null,
      devices,
      rulebookVersion: data.rulebookVersion,
      artifactHash: row.artifactHash,
      issues,
      ...(checklistBreakdown && { checklistBreakdown }),
      ...scopedReportEvidence(data, selectedUrls),
      ...observationPageSpeed(data, row, selectedUrls, input),
      coverage,
    });
    for (const check of data.checks) {
      const identity = checkIdentity(data, check);
      if (
        (check.result === "pass" || check.result === "fired") &&
        !latestChecked.has(identity)
      )
        latestChecked.set(identity, {
          id: row.id,
          result: check.result,
          observedAt: row.observedAt,
        });
    }
    for (const item of data.findings) {
      if (!selectedUrls.has(normalizeSeoUrl(item.pageUrl))) continue;
      const identity = checkIdentity(data, item);
      const issue = issueIdentity(data, item);
      if (
        (seenFindings.has(issue) && seenFindings.get(issue) !== row.id) ||
        (latestChecked.has(identity) &&
          latestChecked.get(identity)?.id !== row.id)
      )
        continue;
      seenFindings.set(issue, row.id);
      findings.push({
        ...item,
        id: `${row.id}:${item.id}`,
        observationId: row.id,
      });
    }
    // A choice is stored per Market. A check without a Market the save schema takes tracks nothing:
    // "Stop tracking" on its keywords could never be stored.
    const trackable =
      saveSeoKeywordSchema.shape.countryCode.safeParse(data.countryCode)
        .success &&
      saveSeoKeywordSchema.shape.languageCode.safeParse(data.languageCode)
        .success;
    for (const item of data.keywords) {
      if (!selectedUrls.has(normalizeSeoUrl(item.pageUrl))) continue;
      const identity = seoKeywordIdentity(
        item,
        data.countryCode,
        data.languageCode,
      );
      if (seenKeywords.has(identity)) continue;
      seenKeywords.add(identity);
      const choice = keywordChoices.get(
        key(
          item.keyword.normalize("NFKC").toLowerCase(),
          data.countryCode,
          data.languageCode,
        ),
      );
      if (choice) observedKeywordChoices.add(choice.id);
      keywords.push(
        observedSeoKeyword(item, choice, {
          id: `${row.id}:keyword:${keywords.length}`,
          observationId: row.id,
          countryCode: data.countryCode,
          languageCode: data.languageCode,
          trackable,
        }),
      );
    }
    for (const item of data.competitors) {
      if (
        item.role === "page" &&
        !selectedUrls.has(normalizeSeoUrl(item.pageUrl))
      )
        continue;
      if (
        item.scopePageUrls?.length &&
        !item.scopePageUrls.some((url) =>
          selectedUrls.has(normalizeSeoUrl(url)),
        )
      )
        continue;
      const url = normalizeSeoUrl(item.pageUrl),
        identity = key(url, item.role);
      if (seenCompetitors.has(identity)) continue;
      seenCompetitors.add(identity);
      const choice = competitorChoices.get(url),
        canConfirm = item.role === "competitor" && canConfirmSeoCompetitor(url);
      competitors.push({
        id: choice?.id ?? `${row.id}:competitor:${competitors.length}`,
        url,
        role: item.role,
        confirmed: choice?.confirmed ?? false,
        source: item.source ?? "links",
        rank: item.rank ?? null,
        backlinks: item.backlinks,
        referringDomains: item.referringDomains,
        observedAt: item.observedAt,
        observationId: row.id,
        version: choice?.version ?? 0,
        canConfirm,
        exclusionReason:
          canConfirm || item.role === "page"
            ? null
            : "Resolve this search redirect before confirming it",
      });
    }
    const rowProposed: string[] = [];
    for (const item of data.actions) {
      if (!selectedUrls.has(normalizeSeoUrl(item.pageUrl))) continue;
      const link = input.actionTasks.find(
        (task) => task.observationId === row.id && task.actionId === item.id,
      );
      const fixed = item.findingIds.map((id) =>
        data.findings.find((candidate) => candidate.id === id),
      );
      // A Task that failed, was cancelled or is gone fixes nothing.
      const taskStatus = link ? taskStatuses.get(link.taskId) : undefined;
      const live = Boolean(
        link && taskStatus && !DEAD_TASK_STATUSES.has(taskStatus),
      );
      const identities = fixed.flatMap((finding) =>
        finding ? [issueIdentity(data, finding)] : [],
      );
      /** A later check read the same row on the same device and it passes. */
      const passedLater = (identity: string, device: string | null) => {
        if (!device) return false;
        const latest = latestChecked.get(identity);
        return latest?.result === "pass" && latest.observedAt > row.observedAt;
      };
      // Keep live work on its history. A proposal without live work stops being current when each of its
      // findings has the fix of a later check, or an exact later pass.
      if (
        !live &&
        fixed.length > 0 &&
        fixed.every(
          (finding) =>
            finding &&
            (proposed.has(issueIdentity(data, finding)) ||
              passedLater(checkIdentity(data, finding), finding.device)),
        )
      )
        continue;
      // An action without live work replaces no older proposal, so the finding keeps one open fix.
      if (!link || live) rowProposed.push(...identities);
      const solved =
        fixed.length > 0 &&
        fixed.every(
          (finding) =>
            finding &&
            passedLater(checkIdentity(data, finding), finding.device),
        );
      // The newest check of each finding passes: the issue is gone, also while its Task is still open.
      const verifiedAt = !link
        ? null
        : solved
          ? latestDate(
              fixed.flatMap((finding) => {
                const latest =
                  finding && latestChecked.get(checkIdentity(data, finding));
                return latest ? [latest.observedAt] : [];
              }),
            )
          : actionVerifiedAt(
              input.tasks.find((task) => task.id === link.taskId),
              input.observations,
              data,
              item,
            );
      const action: ProjectSeoWorkspace["actions"][number] = {
        ...item,
        observationId: row.id,
        findingIds: item.findingIds.map((id) => `${row.id}:${id}`),
        kind: "fix",
        evidence: [],
        taskId: link?.taskId ?? null,
        status: !link
          ? "recommended"
          : verifiedAt
            ? "verified"
            : taskStatus === "COMPLETED"
              ? "implemented"
              : "task_created",
        ...(verifiedAt ? { verifiedAt: verifiedAt.toISOString() } : {}),
      };
      actions.push(action);
      fixWork.set(action, {
        work: [...identities].sort().join("\n"),
        observedAt: row.observedAt,
        live,
      });
    }
    // Only a later check replaces a proposal: two actions of one check can fix one finding.
    for (const identity of rowProposed) proposed.add(identity);
  }
  // One card per issue. A later check that still finds the issue proposes its fix again: the cards of the newest
  // check stay, whatever their status, and the older cards for the same findings leave. A Task that still works
  // on the issue moves to a later card without a Task, the one with the same title first.
  const byWork = new Map<string, ProjectSeoWorkspace["actions"]>();
  for (const action of actions) {
    const work = fixWork.get(action)?.work;
    if (work) byWork.set(work, [...(byWork.get(work) ?? []), action]);
  }
  const replaced = new Set<ProjectSeoWorkspace["actions"][number]>();
  for (const group of byWork.values()) {
    const at = (action: ProjectSeoWorkspace["actions"][number]) =>
      fixWork.get(action)!.observedAt.getTime();
    // A card whose Task failed, was cancelled or is gone does no work on the issue: it replaces no card, and no
    // card replaces it.
    const working = group.filter(
      (action) => !action.taskId || fixWork.get(action)!.live,
    );
    const newest = Math.max(...working.map(at));
    // The newest check that found the issue, a card with a dead Task included: a Task that ended before it did
    // not hold the fix.
    const found = Math.max(...group.map(at));
    const later = working.filter((action) => at(action) === newest);
    // Cards of the reader's own Tasks: an older card has no later card to move to.
    const own = later.every((card) => Boolean(card.taskId));
    const moving: ProjectSeoWorkspace["actions"] = [];
    for (const action of working) {
      if (at(action) === newest) continue;
      replaced.add(action);
      if (
        !fixWork.get(action)!.live ||
        (action.status !== "task_created" && action.status !== "implemented")
      )
        continue;
      // A Task that ended before the later check did not hold the fix: the later card is an open action again.
      // A finished Task without an end time gives no proof either way, so the later card stays open too.
      if (action.status === "implemented") {
        const done = input.tasks.find(
          (task) => task.id === action.taskId,
        )?.completedAt;
        if (!done || found > done.getTime()) continue;
      }
      moving.push(action);
    }
    const free = () =>
      later.filter((card) => !card.taskId && card.status === "recommended");
    const move = (
      action: ProjectSeoWorkspace["actions"][number],
      card: ProjectSeoWorkspace["actions"][number] | undefined,
    ) => {
      if (!card) return false;
      card.taskId = action.taskId;
      card.status = action.status;
      return true;
    };
    // The same title first for every Task, then any card left.
    const unmatched = moving.filter(
      (action) =>
        !move(
          action,
          free().find((card) => card.title === action.title),
        ),
    );
    // A Task that finds no later card keeps its own card, unless the later cards all carry the reader's Tasks.
    for (const action of unmatched)
      if (!move(action, free()[0]) && !own) replaced.delete(action);
  }
  if (replaced.size)
    actions.splice(
      0,
      actions.length,
      ...actions.filter((action) => !replaced.has(action)),
    );
  for (const choice of input.keywords) {
    if (
      !choice.saved ||
      (choice.pageId && !selectedIds.has(choice.pageId)) ||
      observedKeywordChoices.has(choice.id)
    )
      continue;
    keywords.push(
      savedSeoKeyword(
        choice,
        input.pages.find((page) => page.id === choice.pageId)?.url ?? null,
      ),
    );
  }
  for (const choice of input.competitors)
    if (!competitors.some((row) => row.id === choice.id))
      competitors.push({
        id: choice.id,
        url: choice.url,
        role: "competitor",
        confirmed: choice.confirmed,
        source: "saved",
        rank: null,
        backlinks: null,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: choice.version,
        canConfirm: canConfirmSeoCompetitor(choice.url),
        exclusionReason: null,
      });
  const search = projectSearchEvidence(
    searchSources,
    actionTasks,
    taskStatuses,
  );
  actions.push(...decisions.actions, ...search.actions);
  applySeoActionTaskVisibility(actions, input.actionTasks, input.tasks);
  for (const link of actionTasks) {
    const observation =
      scopedPublicSources.get(link.observationId) ??
      searchSources.find((source) => source.row.id === link.observationId)?.row;
    if (!observation) continue;
    timeline.push({
      id: `action:${link.id}`,
      kind: "action",
      title: "Recommendation linked to a Task",
      at: link.createdAt.toISOString(),
      pageIds: observation.pageIds,
      observationId: link.observationId,
      taskId: link.taskId,
      status: taskStatuses.get(link.taskId) ?? "unavailable",
      detail:
        "Task completion records implementation. A fresh check is required for verification.",
    });
  }
  const analyses = input.analyses
    .filter((row) => overlaps(row.pageIds))
    .map((row) => {
      const taskStatus = row.taskId ? taskStatuses.get(row.taskId) : undefined;
      const status =
        row.status === "completed"
          ? "completed"
          : row.status === "failed"
            ? "failed"
            : taskStatus === "FAILED" || taskStatus === "CANCELED"
              ? "failed"
              : taskStatus === "RUNNING" || taskStatus === "COMPLETED"
                ? "running"
                : row.status;
      return {
        id: row.id,
        kind: row.kind,
        status,
        taskId: row.taskId,
        pageIds: row.pageIds,
        scopeVersion: row.scopeVersion,
        createdAt: row.createdAt.toISOString(),
      };
    });
  for (const analysis of analyses)
    if (analysis.status !== "completed")
      timeline.push({
        id: `analysis:${analysis.id}`,
        kind: "check",
        title: "SEO analysis requested",
        at: analysis.createdAt,
        pageIds: analysis.pageIds,
        observationId: null,
        taskId: analysis.taskId,
        status: analysis.status,
        detail: "The requested scope is frozen for this analysis.",
      });
  timeline.push(...metricRows.collections.values());
  timeline.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const editable = !project.closedAt && !project.closingAt;
  const indexing = indexAuditFindings(
    input.privateMetricsAllowed ? input.observations : [],
    [...scopedPublicSources.values()],
    selectedUrls,
    query,
  );
  return projectSeoWorkspaceSchema.parse({
    sharing: input.sharing ?? "personal",
    projectId: project.auditId ? (project.projectId ?? null) : project.id,
    auditId: project.auditId ?? null,
    auditName: project.name ?? null,
    websiteUrl: project.websiteUrl,
    scope: {
      id: scope.id,
      name: scope.name,
      version: scope.version,
      pageIds: scope.pageIds,
      from: query.from ?? null,
      to: query.to ?? null,
    },
    pages: input.pages,
    scopes: input.scopes,
    observations: withIndexIssueCounts(observations, indexing.counts),
    history: {
      limit: SEO_RESULT_LIMIT,
      limited: input.historyLimited,
      evidenceLimited: input.evidenceLimited,
    },
    keywords,
    competitors,
    findings: [...findings, ...indexing.findings],
    actions,
    metrics,
    searchQueries: search.searchQueries,
    searchBreakdown: search.searchBreakdown,
    landingPages: metricRows.landingPages,
    landingEngagementChange: landingEngagementChange(
      metricRows.landingSources,
      query,
    ),
    indexStatus: newestIndexStatus(indexSources, selectedUrls),
    indexTriage: indexing.triage,
    ...(input.privateMetricsAllowed
      ? projectSiteEvidence(input.observations, selectedUrls, query)
      : { siteEvidence: null, auditSiteEvidence: [] }),
    strategy,
    siteSpeed: siteSpeed ?? null,
    ...decisions.workspaceEvidence,
    metricsStatus: !metrics.length
      ? "unavailable"
      : metrics.some((metric) => metric.coverage !== "complete")
        ? "partial"
        : "available",
    timeline: timeline.filter((item) =>
      matchesSeoPeriod(new Date(item.at), query),
    ),
    runs: withIndexIssueCounts(runs, indexing.counts).map((run) =>
      run.issues === 0 && incompleteRuns.has(run.observationId)
        ? { ...run, issues: null }
        : run,
    ),
    analyses,
    monitors: (input.monitors ?? []).filter((monitor) =>
      overlaps(monitor.pageIds),
    ),
    availableActions: {
      canEdit: editable,
      canRequestAnalysis:
        editable &&
        input.analysisDispatchEnabled === true &&
        scope.pageIds.length > 0,
      canUsePaidSearchData:
        editable &&
        input.analysisDispatchEnabled === true &&
        input.canUsePaidSearchData === true,
      canCreateMonitor:
        editable &&
        input.analysisDispatchEnabled === true &&
        input.canSchedule === true &&
        scope.pageIds.length > 0,
      canSyncMetrics:
        editable && input.privateMetricsAllowed && scope.pageIds.length > 0,
    },
  });
}
