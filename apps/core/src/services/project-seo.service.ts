import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { badRequest, conflict, forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { isSeoAnalysisDispatchEnabled } from "@/lib/seo/analysis-dispatch";
import {
  addSeoPageSchema,
  createSeoScopeSchema,
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
  type SeoActor,
  type SeoWorkspaceQuery,
  saveSeoCompetitorSchema,
  saveSeoKeywordSchema,
  updateSeoScopeSchema,
} from "@/schemas/project-seo.schema";
import { listProjectSeoMonitors } from "./project-seo-monitor.service";
import { projectSeoProjection } from "./project-seo-projection";
import {
  canConfirmSeoCompetitor,
  canReadPrivateSeoMetrics,
  commitSeoMutation,
  normalizeSeoUrl,
  requireLockedSeoProject,
  requireSeoPages,
  requireSeoProject,
  resolveSeoScope,
  type SeoMutationHooks,
  sha256,
} from "./project-seo-store";

export async function addProjectSeoPage(
  actor: SeoActor,
  input: z.infer<typeof addSeoPageSchema>,
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoProject(tx, actor);
    await hooks.authorize?.(tx);
    if (input.relatedToPageId)
      await requireSeoPages(actor, [input.relatedToPageId], tx);
    const result = await tx.projectSeoPage.upsert({
      where: {
        projectId_url: {
          projectId: actor.projectId,
          url: normalizeSeoUrl(input.url),
        },
      },
      create: {
        projectId: actor.projectId,
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
    await requireLockedSeoProject(tx, actor);
    await hooks.authorize?.(tx);
    const pages = await requireSeoPages(actor, input.pageIds, tx);
    const result = await tx.projectSeoScope.create({
      data: {
        projectId: actor.projectId,
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
    await requireLockedSeoProject(tx, actor);
    await hooks.authorize?.(tx);
    const pages = await requireSeoPages(actor, input.pageIds, tx);
    const changed = await tx.projectSeoScope.updateMany({
      where: {
        id: scopeId,
        projectId: actor.projectId,
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
    await requireLockedSeoProject(tx, actor);
    await hooks.authorize?.(tx);
    if (input.pageId) await requireSeoPages(actor, [input.pageId], tx);
    const identity = {
      projectId: actor.projectId,
      keywordKey: input.keyword.normalize("NFKC").toLowerCase(),
      countryCode: input.countryCode,
      languageCode: input.languageCode,
    };
    const previous = await tx.projectSeoKeyword.findUnique({
      where: { projectId_keywordKey_countryCode_languageCode: identity },
    });
    if (previous && input.expectedVersion !== previous.version)
      throw conflict("The saved keyword changed. Reload it before editing.");
    const result = await tx.projectSeoKeyword.upsert({
      where: { projectId_keywordKey_countryCode_languageCode: identity },
      create: {
        ...identity,
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
    await requireLockedSeoProject(tx, actor);
    await hooks.authorize?.(tx);
    const identity = { projectId: actor.projectId, url };
    const previous = await tx.projectSeoCompetitor.findUnique({
      where: { projectId_url: identity },
    });
    if (previous && input.expectedVersion !== previous.version)
      throw conflict(
        "The competitor choice changed. Reload it before editing.",
      );
    const result = await tx.projectSeoCompetitor.upsert({
      where: { projectId_url: identity },
      create: { ...identity, confirmed: input.confirmed },
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
    scope?: { id: string | null; version: number; pageIds: string[] };
  } = {},
) {
  const payload = nativeSeoMetricsSchema.parse(input);
  const write = async (client: Prisma.TransactionClient) => {
    await requireSeoProject(actor, client, true);
    await options.authorize?.(client);
    if (!(await canReadPrivateSeoMetrics(actor, client)))
      throw forbidden(
        "Only the owner's personal Soko Bot may retain private analytics",
      );
    const pages = await client.projectSeoPage.findMany({
      where: {
        projectId: actor.projectId,
        url: { in: payload.pageUrls.map(normalizeSeoUrl) },
      },
    });
    if (pages.length !== new Set(payload.pageUrls.map(normalizeSeoUrl)).size)
      throw notFound("An analytics page is outside the selected Project");
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
            projectId: actor.projectId,
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
    const body = JSON.stringify(payload),
      artifactHash = sha256(body),
      sourceKey = `native:${sha256(`${actor.userId}:${payload.provider}:${payload.propertyId}:${artifactHash}`)}`;
    const data: Prisma.InputJsonObject = payload;
    const result = await client.projectSeoObservation.upsert({
      where: { projectId_sourceKey: { projectId: actor.projectId, sourceKey } },
      create: {
        projectId: actor.projectId,
        ownerId: actor.userId,
        kind: "metrics",
        source: payload.provider,
        sourceKey,
        pageIds: options.scope?.pageIds ?? pages.map((page) => page.id),
        scopeVersion: options.scope?.version ?? 0,
        artifactHash,
        payload: data,
        observedAt: new Date(payload.observedAt),
      },
      update: {},
    });
    return commitSeoMutation(client, result, options);
  };
  return options.client
    ? write(options.client)
    : serializableTransaction(
        write,
        "The analytics scope changed. Please retry.",
      );
}

export async function getProjectSeoWorkspace(
  actor: SeoActor,
  query: SeoWorkspaceQuery = {},
) {
  const project = await requireSeoProject(actor);
  const scope = await resolveSeoScope(actor, query);
  const privateMetricsAllowed = await canReadPrivateSeoMetrics(actor);
  const [
    pages,
    scopes,
    observations,
    keywords,
    competitors,
    analyses,
    actionTasks,
    monitors,
  ] = await Promise.all([
    prisma.projectSeoPage.findMany({
      where: { projectId: actor.projectId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.projectSeoScope.findMany({
      where: { projectId: actor.projectId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.projectSeoObservation.findMany({
      where: {
        projectId: actor.projectId,
        pageIds: { hasSome: scope.pageIds },
        OR: [
          { ownerId: null },
          ...(privateMetricsAllowed ? [{ ownerId: actor.userId }] : []),
        ],
      },
      orderBy: { observedAt: "desc" },
      take: 100,
    }),
    prisma.projectSeoKeyword.findMany({
      where: { projectId: actor.projectId },
      orderBy: { keyword: "asc" },
    }),
    prisma.projectSeoCompetitor.findMany({
      where: { projectId: actor.projectId },
      orderBy: { url: "asc" },
    }),
    prisma.projectSeoAnalysis.findMany({
      where: {
        projectId: actor.projectId,
        pageIds: { hasSome: scope.pageIds },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.projectSeoActionTask.findMany({
      where: { projectId: actor.projectId },
    }),
    listProjectSeoMonitors(actor),
  ]);
  const taskIds = [
    ...new Set([
      ...actionTasks.map((item) => item.taskId),
      ...analyses.flatMap((item) => (item.taskId ? [item.taskId] : [])),
    ]),
  ];
  const taskRows = taskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: taskIds }, workspaceId: actor.workspaceId },
        select: {
          id: true,
          status: true,
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
  return projectSeoProjection({
    project,
    query,
    scope,
    pages,
    scopes,
    observations,
    keywords,
    competitors,
    analyses,
    actionTasks,
    tasks,
    privateMetricsAllowed,
    analysisDispatchEnabled: isSeoAnalysisDispatchEnabled(),
    monitors,
  });
}
