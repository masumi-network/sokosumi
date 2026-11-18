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
import {
  type SeoMutationHooks,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import type { SeoStatisticsIntegration } from "./seo-connections.service";
import { syncLockService } from "./sync-lock.service";

const SEO_STATISTICS_FRESH_MS = 24 * 60 * 60 * 1000;
const SEO_STATISTICS_QUERY_RETRY_MS = 60 * 60 * 1000;

interface AutomaticStatistics<T> {
  actor: SeoActor;
  input: SyncProjectSeoStatistics;
  integration: SeoStatisticsIntegration;
  pageIds: string[];
  pageUrls: string[];
  keywords: ProjectSeoWorkspace["keywords"];
  hooks: SeoMutationHooks;
  readWorkspace: () => Promise<T>;
  activate: (snapshot: NativeSeoMetrics, hooks: SeoMutationHooks) => Promise<T>;
  collect: (fingerprint: string, hooks: SeoMutationHooks) => Promise<T>;
}

/** Cache only the exact viewer, account revision, pages and report selection. */
export async function withAutomaticSeoStatistics<T>(
  context: AutomaticStatistics<T>,
): Promise<T> {
  const { actor, input, integration, hooks } = context;
  const fingerprint = sha256(
    JSON.stringify({
      workspaceId: actor.workspaceId,
      owner: actor.owner,
      userId: actor.userId,
      organizationId: actor.organizationId,
      account: integration.composioAccountId,
      entity: integration.entityId,
      revision: integration.connectionRevision,
      provider: input.provider,
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
        input.provider === "search_console"
          ? selectTrackedKeywords(context.keywords)
          : null,
    }),
  );
  if (!input.automatic) return context.collect(fingerprint, hooks);

  async function fresh() {
    const rows = await prisma.projectSeoObservation.findMany({
      where: {
        ...seoOwnerWhere(actor),
        ownerId: actor.userId,
        visibility: seoVisibilityFor(actor),
        kind: "metrics",
        source: input.provider,
        payload: { path: ["collectionFingerprint"], equals: fingerprint },
        observedAt: { gte: new Date(Date.now() - SEO_STATISTICS_FRESH_MS) },
      },
      orderBy: { observedAt: "desc" },
      take: 1,
    });
    const result = nativeSeoMetricsSchema.safeParse(rows[0]?.payload);
    if (!result.success || result.data.collectionFingerprint !== fingerprint)
      return null;
    const data = result.data;
    const age =
      Date.now() - new Date(data.collectedAt ?? data.observedAt).getTime();
    const retryQueries =
      data.provider === "search_console" &&
      seoSearchTypeHasQueries(data.searchType ?? "web") &&
      !data.queries;
    return age >= 0 &&
      age <
        (retryQueries ? SEO_STATISTICS_QUERY_RETRY_MS : SEO_STATISTICS_FRESH_MS)
      ? data
      : null;
  }
  async function cachedWorkspace(snapshot: NativeSeoMetrics) {
    // Charts include shared snapshots from other members. Compare the same
    // visible page rows before reusing this viewer's cached selection.
    const [latest] = await prisma.projectSeoObservation.findMany({
      where: {
        ...seoOwnerWhere(actor),
        ownerId: actor.organizationId ? { not: null } : actor.userId,
        pageIds: { hasSome: context.pageIds },
        visibility: seoVisibilityFor(actor),
        kind: "metrics",
        source: input.provider,
      },
      orderBy: { observedAt: "desc" },
      take: 1,
    });
    const last = nativeSeoMetricsSchema.safeParse(latest?.payload);
    if (!last.success || last.data.collectionFingerprint !== fingerprint) {
      return context.activate(
        {
          ...snapshot,
          collectedAt: snapshot.collectedAt ?? snapshot.observedAt,
          observedAt: new Date().toISOString(),
        },
        hooks,
      );
    }
    if (hooks.authorize) await prisma.$transaction(hooks.authorize);
    return context.readWorkspace();
  }
  const saved = await fresh();
  if (saved) return cachedWorkspace(saved);
  const key = `seo-statistics:${fingerprint}`;
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
    const current = await fresh();
    if (current) return cachedWorkspace(current);
    return await context.collect(fingerprint, {
      ...hooks,
      authorize: async (tx) => {
        await hooks.authorize?.(tx);
        // The no-op write holds the lease row until the metrics commit. A timed-out
        // collector cannot save after another request takes its expired lease.
        const current = await tx.lock.updateMany({
          where: {
            key,
            isLocked: true,
            lockedBy: lock.ownerToken,
            lockedAt: { gte: new Date(Date.now() - getEnv().LOCK_TIMEOUT) },
          },
          data: { lockedBy: lock.ownerToken },
        });
        if (!current.count)
          throw conflict("Statistics collection expired. Please retry.");
      },
    });
  } finally {
    await syncLockService.releaseLock(lock.key, lock.ownerToken);
  }
}
