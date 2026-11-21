import { Prisma } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { conflict } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { seoVisibilityFor } from "@/lib/seo/data-visibility";
import { selectTrackedKeywords } from "@/lib/seo/native-gsc-queries";
import type {
  ProjectSeoWorkspace,
  SeoActor,
} from "@/schemas/project-seo.schema";
import {
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
} from "@/schemas/project-seo-native-metrics.schema";
import type { SyncProjectSeoStatistics } from "@/schemas/project-seo-statistics.schema";
import { seoSearchTypeHasQueries } from "@/schemas/project-seo-traffic.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { auditPageDiscoveryComplete } from "@/schemas/seo-page-discovery.schema";
import {
  inspectionCacheKey,
  inspectionsDue,
  SEO_STATISTICS_FRESH_MS,
  SEO_STATISTICS_RETRY_MS,
} from "./project-seo-statistics-inspections";
import {
  type SeoMutationHooks,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import type { SeoStatisticsIntegration } from "./seo-connections.service";
import { syncLockService } from "./sync-lock.service";

export interface AuditStatisticsScope {
  taskId: string;
  connectionVersion: string;
  pageUrls: string[];
  includeSitemaps?: true;
  propertyTotals?: "include" | "only";
  pageDiscovery?: boolean;
}

interface AutomaticStatistics<T> {
  actor: SeoActor;
  audit?: AuditStatisticsScope;
  input: SyncProjectSeoStatistics;
  integration: SeoStatisticsIntegration;
  pageIds: string[];
  pageUrls: string[];
  keywords: ProjectSeoWorkspace["keywords"];
  hooks: SeoMutationHooks;
  readWorkspace: () => Promise<T>;
  activate: (snapshot: NativeSeoMetrics, hooks: SeoMutationHooks) => Promise<T>;
  collect: (
    fingerprint: string,
    hooks: SeoMutationHooks,
    cached?: NativeSeoMetrics,
  ) => Promise<T>;
}

/** Cache only the exact viewer, account revision, pages and report selection. */
export async function withAutomaticSeoStatistics<T>(
  context: AutomaticStatistics<T>,
): Promise<T> {
  const { actor, input, integration, hooks } = context;
  const auditTaskId = context.audit?.taskId;
  const fingerprint = sha256(
    JSON.stringify({
      workspaceId: actor.workspaceId,
      ...(auditTaskId && { auditTaskId }),
      owner: actor.owner,
      userId: actor.userId,
      organizationId: actor.organizationId,
      account: integration.composioAccountId,
      entity: integration.entityId,
      revision: integration.connectionRevision,
      provider: input.provider,
      ...(input.provider === "ga4" &&
        input.channel !== "ai_assistant" && { landingEngagementVersion: 1 }),
      ...(input.provider === "ga4" &&
        input.channel !== "ai_assistant" &&
        !actor.sokoBotId && { landingOutcomeVersion: 1 }),
      propertyId: input.propertyId,
      pageUrls: [...context.pageUrls].sort(),
      from: input.from,
      to: input.to,
      channel: input.channel ?? "all",
      searchType: input.searchType ?? "web",
      keywords:
        !auditTaskId && input.provider === "search_console"
          ? selectTrackedKeywords(context.keywords)
          : null,
    }),
  );
  if (!input.automatic && input.provider !== "search_console")
    return context.collect(fingerprint, hooks);

  async function fresh() {
    const rows = await prisma.projectSeoObservation.findMany({
      where: {
        ...seoOwnerWhere(actor),
        ownerId: actor.userId,
        visibility: auditTaskId ? "PRIVATE" : seoVisibilityFor(actor),
        ...(auditTaskId && { sourceTaskId: auditTaskId }),
        kind: auditTaskId ? AUDIT_PERFORMANCE_KIND : "metrics",
        source: input.provider,
        payload: { path: ["collectionFingerprint"], equals: fingerprint },
        ...(!auditTaskId && {
          observedAt: { gte: new Date(Date.now() - SEO_STATISTICS_FRESH_MS) },
        }),
      },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 1,
    });
    const result = nativeSeoMetricsSchema.safeParse(rows[0]?.payload);
    if (!result.success || result.data.collectionFingerprint !== fingerprint)
      return null;
    const data = result.data;
    if (auditTaskId)
      return data.auditPerformanceComplete ||
        context.audit?.includeSitemaps ||
        context.audit?.propertyTotals
        ? data
        : null;
    const age =
      Date.now() - new Date(data.collectedAt ?? data.observedAt).getTime();
    const retryQueries =
      data.provider === "search_console" &&
      seoSearchTypeHasQueries(data.searchType ?? "web") &&
      !data.queries;
    return age >= 0 &&
      age < (retryQueries ? SEO_STATISTICS_RETRY_MS : SEO_STATISTICS_FRESH_MS)
      ? data
      : null;
  }
  async function isActive() {
    // Charts include shared snapshots from other members. Compare the same
    // visible page rows before reusing this viewer's cached selection.
    const [latest] = await prisma.projectSeoObservation.findMany({
      where: {
        ...seoOwnerWhere(actor),
        ownerId: actor.organizationId ? { not: null } : actor.userId,
        pageIds: { hasSome: context.pageIds },
        // JSON containment ignores array order. The absent next element excludes supersets.
        AND: [
          { payload: { path: ["pageUrls"], array_contains: context.pageUrls } },
          {
            payload: {
              path: ["pageUrls", String(context.pageUrls.length)],
              equals: Prisma.DbNull,
            },
          },
        ],
        visibility: seoVisibilityFor(actor),
        kind: "metrics",
        source: input.provider,
      },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 1,
    });
    const last = nativeSeoMetricsSchema.safeParse(latest?.payload);
    return last.success && last.data.collectionFingerprint === fingerprint;
  }
  async function readCachedWorkspace() {
    if (hooks.authorize) await prisma.$transaction(hooks.authorize);
    return context.readWorkspace();
  }
  function auditComplete(data: NativeSeoMetrics) {
    if (
      context.audit?.pageDiscovery &&
      !auditPageDiscoveryComplete(data.auditPageDiscovery)
    )
      return false;
    if (context.audit?.propertyTotals === "only")
      return !!data.auditPropertyTotals;
    return (
      data.auditPerformanceComplete &&
      (!context.audit?.propertyTotals || !!data.auditPropertyTotals) &&
      (!context.audit?.includeSitemaps ||
        (data.auditDiscovery && data.auditDiscovery.status !== "unavailable"))
    );
  }
  const saved = input.automatic ? await fresh() : null;
  if (auditTaskId && saved && auditComplete(saved))
    return readCachedWorkspace();
  if (!auditTaskId && saved && !inspectionsDue(saved) && (await isActive()))
    return readCachedWorkspace();
  // Reports that share URL Inspection data must not both spend the same page quota.
  const lockScope =
    input.provider === "search_console"
      ? inspectionCacheKey(actor, integration, input.propertyId)
      : fingerprint;
  const key = `seo-statistics:${lockScope}`;
  const lock = await syncLockService
    .acquireLock(key)
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "LOCK_IS_LOCKED")
        throw conflict(
          "Statistics collection is already in progress. Try again shortly.",
        );
      throw error;
    });
  try {
    const current = input.automatic ? await fresh() : null;
    const leasedHooks: SeoMutationHooks = {
      ...hooks,
      authorize: async (tx) => {
        await hooks.authorize?.(tx);
        // Hold the lease until the metrics write commits, including cache reactivation.
        const held = await tx.lock.updateMany({
          where: {
            key,
            isLocked: true,
            lockedBy: lock.ownerToken,
            lockedAt: { gte: new Date(Date.now() - getEnv().LOCK_TIMEOUT) },
          },
          data: { lockedBy: lock.ownerToken },
        });
        if (!held.count)
          throw conflict("Statistics collection expired. Please retry.");
      },
    };
    if (auditTaskId && current) {
      if (auditComplete(current)) return await readCachedWorkspace();
      return await context.collect(fingerprint, leasedHooks, current);
    }
    if (current && !inspectionsDue(current)) {
      if (await isActive()) return readCachedWorkspace();
      return await context.activate(
        {
          ...current,
          ...(current.inspectionCache && {
            inspectionCache: { ...current.inspectionCache, readUrls: [] },
          }),
          collectedAt: current.collectedAt ?? current.observedAt,
          observedAt: new Date().toISOString(),
        },
        leasedHooks,
      );
    }
    return await context.collect(
      fingerprint,
      leasedHooks,
      current ?? undefined,
    );
  } finally {
    await syncLockService.releaseLock(lock.key, lock.ownerToken);
  }
}
