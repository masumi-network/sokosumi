import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { badRequest, conflict, forbidden, notFound } from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import { reportObject } from "@/helpers/project-seo-public-report";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { findSeoAnalysisExecutor } from "@/lib/seo/analysis-dispatch";
import { preserveAuditPerformance } from "@/lib/seo/audit-performance-retry";
import {
  SEO_DATA_VISIBILITY,
  seoSharingFor,
  seoVisibilityFor,
} from "@/lib/seo/data-visibility";
import {
  addSeoPageSchema,
  createSeoScopeSchema,
  type SeoActor,
  type SeoWorkspaceQuery,
  saveSeoCompetitorSchema,
  saveSeoKeywordSchema,
  updateSeoScopeSchema,
} from "@/schemas/project-seo.schema";
import {
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
} from "@/schemas/project-seo-native-metrics.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import {
  type PrivateLandingOutcomes,
  privateLandingOutcomeSchema,
  privateLandingSourceSchema,
} from "@/schemas/seo-landing-outcomes.schema";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";
import { listProjectSeoMonitors } from "./project-seo-monitor.service";
import { seoMonitorOfTasks } from "./project-seo-monitor-runs";
import { projectSeoProjection } from "./project-seo-projection";
import {
  loadSeoRankPoints,
  loadSeoRankSources,
} from "./project-seo-rank-sources";
import { seoRankKeys, withSeoRankings } from "./project-seo-rankings";
import { loadSeoBrandTerms } from "./project-seo-settings.service";
import {
  canConfirmSeoCompetitor,
  canReadPrivateSeoMetrics,
  commitSeoMutation,
  normalizeSeoUrl,
  requireLockedSeoOwner,
  requireSeoOwner,
  requireSeoPages,
  resolveSeoScope,
  type SeoMutationHooks,
  seoLinkedTaskWhere,
  seoOwnerData,
  seoOwnerUnique,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { pendingSeoActionReviews } from "./seo-action-review-store";
import { readAuditPerformanceSummaries } from "./seo-audit-performance-summary";
import { SEO_LANDING_OUTCOMES_KIND } from "./seo-brief-landing-outcomes";
import { projectLegacyIndexingProvenance } from "./seo-indexing-provenance";
import { loadPrivateRecommendationReviews } from "./seo-private-recommendation-reviews";
import { privateTopicQueries } from "./seo-private-topic-queries";
import { loadSeoReviewHistory } from "./seo-recommendation-history";

export async function addProjectSeoPage(
  actor: SeoActor,
  input: z.infer<typeof addSeoPageSchema>,
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    if (input.relatedToPageId)
      await requireSeoPages(actor, [input.relatedToPageId], tx);
    const result = await tx.projectSeoPage.upsert({
      where: seoOwnerUnique(actor, "url", { url: normalizeSeoUrl(input.url) }),
      create: {
        ...seoOwnerWhere(actor),
        url: normalizeSeoUrl(input.url),
        label: input.label ?? "",
        relationship: input.relationship,
        relatedToPageId: input.relatedToPageId ?? null,
      },
      update: {},
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The page changed. Please retry.");
}
export async function createProjectSeoScope(
  actor: SeoActor,
  input: z.infer<typeof createSeoScopeSchema>,
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const pages = await requireSeoPages(actor, input.pageIds, tx);
    const result = await tx.projectSeoScope.create({
      data: {
        ...seoOwnerWhere(actor),
        name: input.name,
        pageIds: pages.map((page) => page.id),
      },
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The page group changed. Please retry.");
}
export async function updateProjectSeoScope(
  actor: SeoActor,
  scopeId: string,
  input: z.infer<typeof updateSeoScopeSchema>,
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const pages = await requireSeoPages(actor, input.pageIds, tx);
    const changed = await tx.projectSeoScope.updateMany({
      where: {
        id: scopeId,
        ...seoOwnerWhere(actor),
        version: input.expectedVersion,
      },
      data: {
        name: input.name,
        pageIds: pages.map((page) => page.id),
        version: { increment: 1 },
      },
    });
    if (!changed.count)
      throw conflict("The page group changed. Reload it before editing.");
    return commitSeoMutation(
      tx,
      await tx.projectSeoScope.findUniqueOrThrow({ where: { id: scopeId } }),
      hooks,
    );
  }, "The page group changed. Please retry.");
}
export async function saveProjectSeoKeyword(
  actor: SeoActor,
  input: z.infer<typeof saveSeoKeywordSchema>,
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    if (input.pageId) await requireSeoPages(actor, [input.pageId], tx);
    const identity = {
      keywordKey: input.keyword.normalize("NFKC").toLowerCase(),
      countryCode: input.countryCode,
      languageCode: input.languageCode,
    };
    const previous = await tx.projectSeoKeyword.findUnique({
      where: seoOwnerUnique(
        actor,
        "keywordKey_countryCode_languageCode",
        identity,
      ),
    });
    if (previous && input.expectedVersion !== previous.version)
      throw conflict("The saved keyword changed. Reload it before editing.");
    const result = await tx.projectSeoKeyword.upsert({
      where: seoOwnerUnique(
        actor,
        "keywordKey_countryCode_languageCode",
        identity,
      ),
      create: {
        ...identity,
        ...seoOwnerData(actor),
        keyword: input.keyword,
        pageId: input.pageId ?? null,
        priority: input.priority,
        saved: input.saved,
      },
      update: {
        keyword: input.keyword,
        pageId: input.pageId ?? null,
        priority: input.priority,
        saved: input.saved,
        version: { increment: 1 },
      },
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The saved keyword changed. Please retry.");
}
export async function saveProjectSeoCompetitor(
  actor: SeoActor,
  input: z.infer<typeof saveSeoCompetitorSchema>,
  hooks: SeoMutationHooks = {},
) {
  const url = normalizeSeoUrl(input.url);
  if (input.confirmed && !canConfirmSeoCompetitor(url))
    throw badRequest(
      "Resolve the search redirect before confirming this competitor",
    );
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const identity = { url };
    const previous = await tx.projectSeoCompetitor.findUnique({
      where: seoOwnerUnique(actor, "url", identity),
    });
    if (previous && input.expectedVersion !== previous.version)
      throw conflict(
        "The competitor choice changed. Reload it before editing.",
      );
    const result = await tx.projectSeoCompetitor.upsert({
      where: seoOwnerUnique(actor, "url", identity),
      create: {
        ...identity,
        ...seoOwnerData(actor),
        confirmed: input.confirmed,
      },
      update: { confirmed: input.confirmed, version: { increment: 1 } },
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The competitor choice changed. Please retry.");
}

export async function recordNativeSeoMetrics(
  actor: SeoActor,
  input: NativeSeoMetrics,
  options: SeoMutationHooks & {
    client?: Prisma.TransactionClient;
    auditTaskId?: string;
    outcomes?: PrivateLandingOutcomes;
    outcomeAccountKey?: string;
    scope?: { id: string | null; version: number; pageIds: string[] };
  } = {},
) {
  const payload = nativeSeoMetricsSchema.parse(input);
  const write = async (client: Prisma.TransactionClient) => {
    await requireLockedSeoOwner(client, actor);
    await options.authorize?.(client);
    if (!(await canReadPrivateSeoMetrics(actor, client)))
      throw forbidden(
        "Only the owner's personal Soko Bot may retain private analytics",
      );
    const pages = await client.projectSeoPage.findMany({
      where: {
        ...seoOwnerWhere(actor),
        url: { in: payload.pageUrls.map(normalizeSeoUrl) },
      },
    });
    if (pages.length !== new Set(payload.pageUrls.map(normalizeSeoUrl)).size)
      throw notFound(
        "An analytics page is outside the selected SEO collection",
      );
    if (options.scope) {
      if (
        pages.length !== options.scope.pageIds.length ||
        pages.some((page) => !options.scope?.pageIds.includes(page.id))
      )
        throw conflict("The analytics scope changed during collection");
      if (options.scope.id) {
        const scope = await client.projectSeoScope.findFirst({
          where: {
            id: options.scope.id,
            ...seoOwnerWhere(actor),
            version: options.scope.version,
          },
        });
        if (
          !scope ||
          scope.pageIds.length !== options.scope.pageIds.length ||
          scope.pageIds.some((id) => !options.scope?.pageIds.includes(id))
        )
          throw conflict("The page group changed during collection");
      }
    }
    const visibility = options.auditTaskId
      ? "PRIVATE"
      : seoVisibilityFor(actor);
    const auditKey =
      options.auditTaskId && `audit-search-console:${options.auditTaskId}`;
    const previous = auditKey
      ? await client.projectSeoObservation.findUnique({
          where: seoOwnerUnique(actor, "sourceKey", { sourceKey: auditKey }),
          select: { payload: true },
        })
      : null;
    const saved = previous
      ? preserveAuditPerformance(
          nativeSeoMetricsSchema.parse(previous.payload),
          payload,
        )
      : payload;
    const artifactHash = sha256(JSON.stringify(saved));
    const sourceKey =
      auditKey ??
      `native:${sha256(`${visibility === SEO_DATA_VISIBILITY.SHARED ? `${visibility}:` : ""}${actor.userId}:${payload.provider}:${payload.propertyId}:${artifactHash}`)}`;
    const result = await client.projectSeoObservation.upsert({
      where: seoOwnerUnique(actor, "sourceKey", { sourceKey }),
      create: {
        ...seoOwnerWhere(actor),
        ownerId: actor.userId,
        visibility,
        kind: options.auditTaskId ? AUDIT_PERFORMANCE_KIND : "metrics",
        ...(options.auditTaskId && { sourceTaskId: options.auditTaskId }),
        source: payload.provider,
        sourceKey,
        pageIds: options.scope?.pageIds ?? pages.map((page) => page.id),
        scopeVersion: options.scope?.version ?? 0,
        artifactHash,
        payload: jsonInput(saved),
        observedAt: new Date(saved.observedAt),
      },
      update: options.auditTaskId
        ? {
            payload: jsonInput(saved),
            artifactHash,
            observedAt: new Date(saved.observedAt),
          }
        : {},
    });
    const named = options.outcomes
      ? privateLandingOutcomeSchema.parse(options.outcomes)
      : null;
    if (named) {
      const scopeUrls = new Set(pages.map((page) => page.url));
      const control = named.goalInvestigation;
      const prior = payload.landingEngagementEvidence?.previous;
      if (
        actor.sokoBotId ||
        payload.provider !== "ga4" ||
        named.propertyId !== payload.propertyId ||
        (options.outcomeAccountKey &&
          named.accountKey !== options.outcomeAccountKey) ||
        named.verifiedHost !== payload.landingPages?.verifiedHost ||
        payload.landingPages.channel !== "organic" ||
        named.from !== payload.from ||
        named.to !== payload.to ||
        (control &&
          (!scopeUrls.has(control.pageUrl) ||
            !prior ||
            control.before.from !== prior.from ||
            control.before.to !== prior.to ||
            named.timeZone !== prior.landingPages.timeZone ||
            named.timeZone !== payload.landingPages.timeZone ||
            control.before.organic.sessions !==
              prior.landingPages.rows.find(
                (row) => row.pageUrl === control.pageUrl,
              )?.sessions ||
            control.after.organic.sessions !==
              payload.landingPages.rows.find(
                (row) => row.pageUrl === control.pageUrl,
              )?.sessions)) ||
        named.rows.some((row) => !scopeUrls.has(row.pageUrl))
      )
        throw badRequest(
          "Named GA4 landing outcomes must match the verified collection",
        );
    }
    // Record a source switch even when the active collection has no usable named rows.
    // The marker is independent of the landing host and contains no counts or invented zeros.
    const selection =
      payload.provider === "ga4" && options.outcomeAccountKey
        ? privateLandingSourceSchema.parse({
            version: 2,
            accountKey: options.outcomeAccountKey,
            propertyId: payload.propertyId,
          })
        : null;
    const pageIds = pages.map((p) => p.id).sort();
    let stored: PrivateLandingOutcomes | typeof selection = named
      ? { ...named, metricObservationId: result.id }
      : null;
    if (!stored && selection) {
      const previous = await client.projectSeoObservation.findFirst({
        where: {
          ...seoOwnerWhere(actor),
          ownerId: actor.userId,
          visibility: "PRIVATE",
          kind: SEO_LANDING_OUTCOMES_KIND,
          source: "ga4",
          pageIds: { hasSome: pageIds },
        },
        select: { id: true },
      });
      if (previous) stored = selection;
    }
    if (stored) {
      const at = named
        ? (payload.collectedAt ?? payload.observedAt)
        : payload.observedAt;
      const hash = sha256(JSON.stringify([actor.userId, stored, pageIds, at]));
      const sourceKey = `landing-outcomes:${hash}`;
      await client.projectSeoObservation.upsert({
        where: seoOwnerUnique(actor, "sourceKey", { sourceKey }),
        create: {
          ...seoOwnerWhere(actor),
          ownerId: actor.userId,
          visibility: "PRIVATE",
          kind: SEO_LANDING_OUTCOMES_KIND,
          source: "ga4",
          sourceKey,
          artifactHash: hash,
          pageIds,
          payload: stored,
          observedAt: new Date(at),
        },
        update: {},
      });
    }
    return commitSeoMutation(client, result, options);
  };
  return options.client
    ? write(options.client)
    : serializableTransaction(
        write,
        "The analytics scope changed. Please retry.",
      );
}

/** Audit evidence and page changes: the newest rows the workspace shows. */
const SEO_WORKSPACE_EVIDENCE_LIMIT = 100;
/** Native metric snapshots: the newest syncs the workspace shows. */
const SEO_WORKSPACE_METRICS_LIMIT = 100;

/**
 * Loads public evidence and private metric snapshots with separate caps, so
 * frequent syncs never push an audit out of the bounded history. Rows come
 * newest first, as the projection expects.
 */
async function loadSeoWorkspaceObservations(
  actor: SeoActor,
  pageIds: string[],
  privateMetricsAllowed: boolean,
  includePrivateIndexing: boolean,
) {
  // Settings rows cover no page, so the page filter keeps them out.
  const where = { ...seoOwnerWhere(actor), pageIds: { hasSome: pageIds } };
  const [evidence, metrics] = await Promise.all([
    prisma.projectSeoObservation.findMany({
      where: { ...where, ownerId: null },
      // A page and a site artifact may share a capture time. Resolve the tie consistently.
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: SEO_WORKSPACE_EVIDENCE_LIMIT,
    }),
    privateMetricsAllowed
      ? prisma.projectSeoObservation.findMany({
          where: {
            ...where,
            kind: "metrics",
            visibility: seoVisibilityFor(actor),
            ...(actor.organizationId
              ? { ownerId: { not: null } }
              : { ownerId: actor.userId }),
          },
          orderBy: { observedAt: "desc" },
          take: SEO_WORKSPACE_METRICS_LIMIT,
        })
      : [],
  ]);
  const taskIds = evidence.flatMap((row) =>
    row.kind === "audit_full" && row.sourceTaskId ? [row.sourceTaskId] : [],
  );
  // One newest private assessment per loaded audit. Unrelated syncs cannot evict its Console findings.
  const indexing =
    privateMetricsAllowed && includePrivateIndexing && taskIds.length
      ? await prisma.projectSeoObservation.findMany({
          where: {
            ...where,
            kind: { in: ["index_triage", "site_evidence", "index_inspection"] },
            ownerId: actor.userId,
            visibility: "PRIVATE",
            sourceTaskId: { in: taskIds },
          },
          orderBy: [
            { observedAt: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          distinct: ["sourceTaskId", "kind"],
          take: SEO_WORKSPACE_EVIDENCE_LIMIT * 3,
        })
      : [];
  return {
    observations: [
      ...evidence,
      ...metrics,
      ...(await projectLegacyIndexingProvenance(actor, indexing)),
    ].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()),
    historyLimited:
      evidence.length >= SEO_WORKSPACE_EVIDENCE_LIMIT ||
      metrics.length >= SEO_WORKSPACE_METRICS_LIMIT,
    evidenceLimited: evidence.length >= SEO_WORKSPACE_EVIDENCE_LIMIT,
  };
}

export async function getProjectSeoWorkspace(
  actor: SeoActor,
  query: SeoWorkspaceQuery = {},
  options: {
    includePrivateIndexing?: boolean;
    includePrivateReviews?: boolean;
    includeAuditPerformance?: boolean;
  } = {},
) {
  await requireSeoOwner(actor);
  const scope = await resolveSeoScope(actor, query);
  const privateMetricsAllowed = await canReadPrivateSeoMetrics(actor);
  const executor = await findSeoAnalysisExecutor(actor);
  const [
    pages,
    scopes,
    { observations, historyLimited, evidenceLimited },
    keywords,
    competitors,
    analyses,
    actionTasks,
    monitors,
    rankSources,
    brandTerms,
  ] = await Promise.all([
    prisma.projectSeoPage.findMany({
      where: seoOwnerWhere(actor),
      orderBy: { createdAt: "asc" },
    }),
    prisma.projectSeoScope.findMany({
      where: seoOwnerWhere(actor),
      orderBy: { createdAt: "asc" },
    }),
    loadSeoWorkspaceObservations(
      actor,
      scope.pageIds,
      privateMetricsAllowed,
      options.includePrivateIndexing !== false,
    ),
    prisma.projectSeoKeyword.findMany({
      where: seoOwnerWhere(actor),
      orderBy: { keyword: "asc" },
    }),
    prisma.projectSeoCompetitor.findMany({
      where: seoOwnerWhere(actor),
      orderBy: { url: "asc" },
    }),
    prisma.projectSeoAnalysis.findMany({
      where: {
        ...seoOwnerWhere(actor),
        pageIds: { hasSome: scope.pageIds },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.projectSeoActionTask.findMany({
      where: seoOwnerWhere(actor),
    }),
    listProjectSeoMonitors(actor),
    // Rank history has its own bound: metric syncs share the load above.
    loadSeoRankSources(actor, scope.pageIds, query),
    loadSeoBrandTerms(actor),
  ]);
  const taskIds = [
    ...new Set([
      ...observations.flatMap((row) => {
        const payload = reportObject(row.payload);
        const strategy = reportObject(payload?.strategy);
        return row.kind === "audit_full" &&
          row.source === "seo_coworker" &&
          row.sourceTaskId &&
          row.sourceFileId &&
          (payload?.pageSpeed === undefined ||
            (strategy &&
              strategy.markets == null &&
              strategy.marketNote == null))
          ? [row.sourceTaskId]
          : [];
      }),
      ...actionTasks.map((item) => item.taskId),
      ...analyses.flatMap((item) => (item.taskId ? [item.taskId] : [])),
    ]),
  ];
  const taskRows = taskIds.length
    ? await prisma.task.findMany({
        where: {
          id: { in: taskIds },
          ...seoLinkedTaskWhere(actor, privateMetricsAllowed),
        },
        select: {
          id: true,
          status: true,
          ownerId: true,
          projectId: true,
          assigneeId: true,
          visibility: true,
          archivedAt: true,
          events: {
            where: { status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      })
    : [];
  const tasks = taskRows.map((task) => ({
    id: task.id,
    status: task.status,
    completedAt: task.events[0]?.createdAt ?? null,
  }));
  const visibleTasks = new Set(tasks.map((task) => task.id));
  const origins = actionTasks
    .filter(
      (link) =>
        visibleTasks.has(link.taskId) &&
        (link.actionId.startsWith("decision:") ||
          link.actionId.startsWith("seasonal:")),
    )
    .map((link) => link.observationId);
  const reviewHistory = evidenceLimited
    ? await loadSeoReviewHistory(actor, scope.pageIds, query, observations, [
        ...new Set(origins),
      ])
    : [];
  const hasStrategy = [...observations, ...reviewHistory].some(
    (row) =>
      row.ownerId === null &&
      typeof row.payload === "object" &&
      row.payload &&
      "strategyDecisions" in row.payload &&
      Array.isArray(row.payload.strategyDecisions) &&
      row.payload.strategyDecisions.length,
  );
  const privateReviews =
    options.includePrivateReviews && privateMetricsAllowed && hasStrategy
      ? await loadPrivateRecommendationReviews(actor, scope.pages, query)
      : undefined;
  const currentOwner = await requireSeoOwner(actor);
  const monitorOfTask = await seoMonitorOfTasks(
    actor.workspaceId,
    observations.flatMap((row) => (row.sourceTaskId ? [row.sourceTaskId] : [])),
  );
  const workspace = projectSeoProjection({
    project: currentOwner,
    sharing: seoSharingFor(actor),
    query,
    scope,
    pages,
    scopes,
    observations,
    historyLimited,
    evidenceLimited,
    reviewHistory,
    privateReviews,
    keywords,
    competitors,
    analyses,
    actionTasks,
    tasks,
    marketRecoveryTaskIds: new Set(
      taskRows
        .filter(
          (task) =>
            task.status === "COMPLETED" &&
            task.visibility === "PUBLIC" &&
            task.ownerId === actor.userId &&
            task.assigneeId &&
            (task.projectId === null ||
              task.projectId === currentOwner.projectId) &&
            !task.archivedAt &&
            !analyses.some(
              (a) => a.taskId === task.id && a.requestedBy !== actor.userId,
            ),
        )
        .map((task) => task.id),
    ),
    privateMetricsAllowed,
    analysisDispatchEnabled: executor !== null,
    canUsePaidSearchData: executor?.canUsePaidSearchData === true,
    canSchedule: executor?.canSchedule === true,
    monitors,
  });
  const actions = await pendingSeoActionReviews(
    actor,
    workspace,
    privateReviews,
  );
  const sourceTask = new Map(
    observations.map((row) => [row.id, row.sourceTaskId]),
  );
  const topicQueries =
    options.includePrivateReviews && privateMetricsAllowed
      ? privateTopicQueries(actor, workspace.topicLaunches, observations, query)
      : undefined;
  const monitored = {
    ...workspace,
    ...(options.includeAuditPerformance &&
      privateMetricsAllowed &&
      !actor.sokoBotId &&
      (await readAuditPerformanceSummaries(
        actor,
        analyses.flatMap((a) =>
          a.kind === "audit_full" &&
          a.requestedBy === actor.userId &&
          a.taskId &&
          visibleTasks.has(a.taskId)
            ? [a.taskId]
            : [],
        ),
        analyses.flatMap((a) =>
          a.kind === "audit_full" &&
          a.requestedBy === actor.userId &&
          a.taskId &&
          tasks.some(
            (task) => task.id === a.taskId && task.status === "COMPLETED",
          ) &&
          storedSeoAuditSearchConsoleSchema.safeParse(a.request).data
            ?.searchConsoleAccess
            ? [a.taskId]
            : [],
        ),
        new Set(scope.pages.map((page) => page.url)),
      ))),
    ...(topicQueries && { privateTopicQueries: topicQueries }),
    actions,
    runs: workspace.runs?.map((run) => ({
      ...run,
      monitorId:
        monitorOfTask.get(sourceTask.get(run.observationId) ?? "") ?? null,
    })),
  };
  const ranked = withSeoRankings(
    monitored,
    rankSources,
    await loadSeoRankPoints(actor, seoRankKeys(monitored), query),
  );
  return brandTerms ? { ...ranked, brandTerms } : ranked;
}
