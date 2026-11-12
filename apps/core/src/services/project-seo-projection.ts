import { z } from "@hono/zod-openapi";
import type {
  ProjectSeoActionTask,
  ProjectSeoAnalysis,
  ProjectSeoCompetitor,
  ProjectSeoKeyword,
  ProjectSeoObservation,
  ProjectSeoPage,
  ProjectSeoScope,
} from "@sokosumi/database";
import { internalServerError } from "@/helpers/error";
import {
  type PublicSeoPayload,
  publicSeoPayloadSchema,
  seoPayloadCoverage,
} from "@/helpers/project-seo-report";
import {
  nativeSeoMetricsSchema,
  type ProjectSeoWorkspace,
  projectSeoWorkspaceSchema,
  type SeoIndexedPage,
  type SeoWorkspaceQuery,
  seoPageChangePayloadSchema,
} from "@/schemas/project-seo.schema";

import {
  projectSearchEvidence,
  type SearchEvidenceSource,
} from "./project-seo-search-projection";
import {
  canConfirmSeoCompetitor,
  matchesSeoPeriod,
  normalizeSeoUrl,
  SEO_RESULT_LIMIT,
} from "./project-seo-store";

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
  keywords: ProjectSeoKeyword[];
  competitors: ProjectSeoCompetitor[];
  analyses: ProjectSeoAnalysis[];
  actionTasks: ProjectSeoActionTask[];
  tasks: Array<{ id: string; status: string; completedAt: Date | null }>;
  privateMetricsAllowed: boolean;
  analysisDispatchEnabled?: boolean;
  canUsePaidSearchData?: boolean;
  canSchedule?: boolean;
  monitors?: ProjectSeoWorkspace["monitors"];
}
/** Severities that name a problem; notes, tests and measurements do not. */
const SEO_ISSUE_SEVERITIES = new Set(["critical", "major", "minor"]);
const key = (...parts: Array<string | null>) => JSON.stringify(parts);
const priority = z.enum(["low", "medium", "high"]);

function checkIdentity(
  source: PublicSeoPayload,
  check: { pageUrl: string; rowId: string; device: string | null },
) {
  return key(
    normalizeSeoUrl(check.pageUrl),
    check.rowId,
    check.device,
    source.countryCode,
    source.languageCode,
    source.rulebookVersion,
  );
}

function verifiedAction(
  input: ProjectionInput,
  source: PublicSeoPayload,
  action: PublicSeoPayload["actions"][number],
  taskId: string,
): boolean {
  const task = input.tasks.find((item) => item.id === taskId);
  if (
    task?.status !== "COMPLETED" ||
    !task.completedAt ||
    !action.findingIds.length
  )
    return false;
  const referenced = action.findingIds.map((id) =>
    source.findings.find((finding) => finding.id === id),
  );
  if (referenced.some((finding) => !finding?.device)) return false;
  return referenced.every((finding) => {
    if (!finding?.device) return false;
    for (const observation of input.observations) {
      if (
        observation.ownerId ||
        observation.kind === "metrics" ||
        observation.observedAt <= task.completedAt! ||
        observation.createdAt <= task.completedAt!
      )
        continue;
      const parsed = publicSeoPayloadSchema.safeParse(observation.payload);
      if (!parsed.success) continue;
      const data = parsed.data;
      if (
        data.countryCode !== source.countryCode ||
        data.languageCode !== source.languageCode ||
        data.rulebookVersion !== source.rulebookVersion
      )
        continue;
      const check = data.checks.find(
        (row) =>
          normalizeSeoUrl(row.pageUrl) === normalizeSeoUrl(finding.pageUrl) &&
          row.rowId === finding.rowId &&
          row.device === finding.device,
      );
      if (check) return check.result === "pass";
    }
    return false;
  });
}

/** Current views are projections. Historical observations and human choices remain separate. */
export function projectSeoProjection(
  input: ProjectionInput,
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
    observations: ProjectSeoWorkspace["observations"] = [];
  const seenKeywords = new Set<string>(),
    seenCompetitors = new Set<string>(),
    seenFindings = new Set<string>(),
    seenMetricGroups = new Set<string>();
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
  const scopedPublicSources = new Map<string, ProjectSeoObservation>();
  let strategy: ProjectSeoWorkspace["strategy"] = null;
  const searchSources: SearchEvidenceSource[] = [];
  const indexSources: Array<{ at: Date; pages: SeoIndexedPage[] }> = [];
  for (const row of input.observations) {
    if (!overlaps(row.pageIds)) continue;
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
      const parsed = nativeSeoMetricsSchema.safeParse(row.payload);
      if (!row.ownerId)
        throw internalServerError("Stored analytics evidence is not readable");
      // A newer build may store fields this build does not know. That sync is
      // skipped with its timeline entry and verdicts, so a rollback shows the
      // older syncs instead of failing the page. A new enum value still fails.
      if (
        !parsed.success &&
        parsed.error.issues.every((issue) => issue.code === "unrecognized_keys")
      )
        continue;
      if (!parsed.success)
        throw internalServerError("Stored analytics evidence is not readable");
      const data = parsed.data;
      // A verdict belongs to one page, so any sync that inspected a selected page counts.
      if (data.indexedPages)
        indexSources.push({ at: row.observedAt, pages: data.indexedPages });
      // Distinct-user totals cannot be sliced or added from an incompatible page group.
      if (
        data.pageUrls.length !== selectedUrls.size ||
        data.pageUrls.some((url) => !selectedUrls.has(normalizeSeoUrl(url)))
      )
        continue;
      if (query.channel && data.channel !== query.channel) continue;
      if (data.provider === "search_console") searchSources.push({ row, data });
      timeline.push({
        id: `metrics:${row.id}`,
        kind: "metrics",
        title: `${data.provider === "ga4" ? "Analytics" : "Search Console"} statistics synced`,
        at: row.createdAt.toISOString(),
        pageIds: row.pageIds,
        observationId: row.id,
        taskId: null,
        status: data.coverage,
        detail: `${data.from} to ${data.to}. ${data.channel}. ${data.notes.join(" ")}`,
      });
      const group = key(
        data.provider,
        data.propertyId,
        data.from,
        data.to,
        data.channel,
      );
      if (seenMetricGroups.has(group)) continue;
      seenMetricGroups.add(group);
      for (const metric of data.metrics)
        metrics.push({
          id: `${row.id}:${metric.key}`,
          ...metric,
          source: data.provider,
          propertyId: data.propertyId,
          from: data.from,
          to: data.to,
          timeZone: data.timeZone,
          channel: data.channel,
          observedAt: row.observedAt.toISOString(),
          coverage: data.coverage,
          notes: data.notes,
        });
      continue;
    }
    const parsed = publicSeoPayloadSchema.safeParse(row.payload);
    if (!parsed.success)
      throw internalServerError("Stored SEO evidence is not readable");
    const data = parsed.data;
    const coverage = seoPayloadCoverage(data);
    scopedPublicSources.set(row.id, row);
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
    // Rows come newest first, so the first strategy is the newest site audit's.
    if (data.strategy && !strategy)
      strategy = {
        ...data.strategy,
        groups: data.strategy.groups.filter(
          (group) =>
            !group.pageUrl || selectedUrls.has(normalizeSeoUrl(group.pageUrl)),
        ),
        observationId: row.id,
        observedAt: row.observedAt.toISOString(),
        countryCode: data.countryCode || null,
        languageCode: data.languageCode || null,
      };
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
      devices: [
        ...new Set(
          [...data.checks, ...data.findings, ...data.keywords].flatMap(
            (item) => (item.device ? [item.device] : []),
          ),
        ),
      ],
      rulebookVersion: data.rulebookVersion,
      artifactHash: row.artifactHash,
      // One rule that fails on mobile and on desktop is one issue on that page.
      issues: new Set(
        data.findings
          .filter(
            (item) =>
              SEO_ISSUE_SEVERITIES.has(item.severity) &&
              selectedUrls.has(normalizeSeoUrl(item.pageUrl)),
          )
          .map((item) => key(item.rowId, normalizeSeoUrl(item.pageUrl))),
      ).size,
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
      if (
        seenFindings.has(identity) ||
        (latestChecked.has(identity) &&
          latestChecked.get(identity)?.id !== row.id)
      )
        continue;
      seenFindings.add(identity);
      findings.push({
        ...item,
        id: `${row.id}:${item.id}`,
        observationId: row.id,
      });
    }
    for (const item of data.keywords) {
      if (!selectedUrls.has(normalizeSeoUrl(item.pageUrl))) continue;
      const identity = key(
        item.keyword.normalize("NFKC").toLowerCase(),
        normalizeSeoUrl(item.pageUrl),
        item.device,
        item.source ?? "rank_refresh",
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
      keywords.push({
        ...item,
        id: `${row.id}:keyword:${keywords.length}`,
        observationId: row.id,
        countryCode: data.countryCode,
        languageCode: data.languageCode,
        saved: choice?.saved ?? false,
        targetPageId: choice?.pageId ?? null,
        priority: priority.parse(choice?.priority ?? "medium"),
        version: choice?.version ?? 0,
        source: item.source ?? "rank_refresh",
        volume: item.volume ?? null,
        intent: item.intent ?? null,
        conversion: item.conversion ?? null,
        feature: item.feature ?? null,
      });
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
    for (const item of data.actions) {
      if (!selectedUrls.has(normalizeSeoUrl(item.pageUrl))) continue;
      const link = input.actionTasks.find(
        (task) => task.observationId === row.id && task.actionId === item.id,
      );
      // Keep linked work on its history. Unlinked proposals stop being current after an exact later pass.
      if (
        !link &&
        item.findingIds.length > 0 &&
        item.findingIds.every((id) => {
          const finding = data.findings.find(
            (candidate) => candidate.id === id,
          );
          if (!finding?.device) return false;
          const latest = latestChecked.get(checkIdentity(data, finding));
          return (
            latest?.result === "pass" && latest.observedAt > row.observedAt
          );
        })
      )
        continue;
      actions.push({
        ...item,
        observationId: row.id,
        findingIds: item.findingIds.map((id) => `${row.id}:${id}`),
        kind: "fix",
        evidence: [],
        taskId: link?.taskId ?? null,
        status: link
          ? taskStatuses.get(link.taskId) === "COMPLETED"
            ? verifiedAction(input, data, item, link.taskId)
              ? "verified"
              : "implemented"
            : "task_created"
          : "recommended",
      });
    }
  }
  for (const choice of input.keywords) {
    if (
      !choice.saved ||
      (choice.pageId && !selectedIds.has(choice.pageId)) ||
      observedKeywordChoices.has(choice.id)
    )
      continue;
    keywords.push({
      id: choice.id,
      keyword: choice.keyword,
      pageUrl:
        input.pages.find((page) => page.id === choice.pageId)?.url ?? null,
      targetPageId: choice.pageId,
      saved: choice.saved,
      countryCode: choice.countryCode,
      languageCode: choice.languageCode,
      source: "saved",
      volume: null,
      intent: null,
      conversion: null,
      feature: null,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      observedAt: null,
      observationId: null,
      priority: priority.parse(choice.priority),
      version: choice.version,
    });
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
    input.actionTasks,
    taskStatuses,
  );
  actions.push(...search.actions);
  for (const link of input.actionTasks) {
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
  timeline.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const editable = !project.closedAt && !project.closingAt;
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
    observations,
    history: {
      limit: SEO_RESULT_LIMIT,
      limited: input.observations.length >= SEO_RESULT_LIMIT,
    },
    keywords,
    competitors,
    findings,
    actions,
    metrics,
    searchQueries: search.searchQueries,
    indexStatus: newestIndexStatus(indexSources, selectedUrls),
    strategy,
    metricsStatus: !metrics.length
      ? "unavailable"
      : metrics.some((metric) => metric.coverage !== "complete")
        ? "partial"
        : "available",
    timeline: timeline.filter((item) =>
      matchesSeoPeriod(new Date(item.at), query),
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

/** The newest verdict per selected page; observations arrive newest first. */
function newestIndexStatus(
  sources: Array<{ at: Date; pages: SeoIndexedPage[] }>,
  selectedUrls: Set<string>,
): ProjectSeoWorkspace["indexStatus"] {
  const pages = new Map<string, SeoIndexedPage & { checkedAt: string }>();
  for (const source of sources)
    for (const page of source.pages) {
      const url = normalizeSeoUrl(page.pageUrl);
      if (selectedUrls.has(url) && !pages.has(url))
        pages.set(url, { ...page, checkedAt: source.at.toISOString() });
    }
  return pages.size ? { pages: [...pages.values()] } : null;
}
