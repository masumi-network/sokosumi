import { SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoIndexedPage } from "@/schemas/project-seo.schema";
import {
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
} from "@/schemas/project-seo-native-metrics.schema";
import { seoOwnerWhere, sha256 } from "./project-seo-store";
import type { SeoStatisticsIntegration } from "./seo-connections.service";

export const SEO_STATISTICS_FRESH_MS = 24 * 60 * 60 * 1000;
export const SEO_STATISTICS_RETRY_MS = 60 * 60 * 1000;

export function inspectionCacheKey(
  actor: SeoActor,
  integration: SeoStatisticsIntegration,
  propertyId: string,
) {
  return sha256(
    JSON.stringify([
      actor.workspaceId,
      actor.owner.kind,
      actor.owner.id,
      actor.organizationId,
      actor.userId,
      integration.entityId,
      integration.composioAccountId,
      integration.connectionRevision,
      propertyId,
    ]),
  );
}

function attemptTime(data: NativeSeoMetrics, url: string) {
  return (
    data.inspectionCache?.checkedAt[url] ?? data.collectedAt ?? data.observedAt
  );
}

function priorAttempt(data: NativeSeoMetrics, url: string) {
  const page = data.indexedPages?.find((entry) => entry.pageUrl === url);
  const checkedAt = attemptTime(data, url);
  const age = Date.now() - Date.parse(checkedAt);
  return age >= 0 &&
    age < (page ? SEO_STATISTICS_FRESH_MS : SEO_STATISTICS_RETRY_MS)
    ? { page, checkedAt }
    : null;
}

export function inspectionsDue(data: NativeSeoMetrics) {
  return (
    data.provider === "search_console" &&
    data.pageUrls.some((url) => !priorAttempt(data, url))
  );
}

/** Scope the lookup to an actual Google attempt. Selecting cached evidence never extends a page's lifetime. */
export async function collectStatisticsInspections(
  actor: SeoActor,
  key: string,
  pageUrls: string[],
  inspect: (url: string) => Promise<SeoIndexedPage>,
  exactReport?: NativeSeoMetrics,
) {
  const entries = await Promise.all(
    pageUrls.map(async (url) => {
      const row = await prisma.projectSeoObservation.findFirst({
        where: {
          ...seoOwnerWhere(actor),
          ownerId: actor.userId,
          kind: "metrics",
          source: "search_console",
          observedAt: { gte: new Date(Date.now() - SEO_STATISTICS_FRESH_MS) },
          AND: [
            { payload: { path: ["inspectionCache", "key"], equals: key } },
            {
              payload: {
                path: ["inspectionCache", "readUrls"],
                array_contains: [url],
              },
            },
          ],
        },
        select: { payload: true },
        orderBy: [
          { observedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      });
      const saved = nativeSeoMetricsSchema.safeParse(row?.payload);
      const savedAttempt =
        saved.success &&
        saved.data.inspectionCache?.key === key &&
        saved.data.inspectionCache.readUrls.includes(url)
          ? saved.data
          : undefined;
      // An older report can supply its own pages after the account and report fingerprint matched.
      const newest =
        exactReport &&
        (!savedAttempt ||
          Date.parse(attemptTime(exactReport, url)) >
            Date.parse(attemptTime(savedAttempt, url)))
          ? exactReport
          : savedAttempt;
      const recent = newest && priorAttempt(newest, url);
      if (recent) return { url, ...recent, read: false };
      const checkedAt = new Date().toISOString();
      const page = await inspect(url).catch(() => undefined);
      return { url, page, checkedAt, read: true };
    }),
  );
  return {
    indexedPages: entries.flatMap(({ page }) => (page ? [page] : [])),
    inspectionCache: {
      key,
      readUrls: entries.filter((entry) => entry.read).map((entry) => entry.url),
      checkedAt: Object.fromEntries(
        entries.map((entry) => [entry.url, entry.checkedAt]),
      ),
    },
  };
}

export function applyStatisticsInspections(
  metrics: NativeSeoMetrics,
  inspections: Awaited<ReturnType<typeof collectStatisticsInspections>>,
) {
  if (inspections.indexedPages.length)
    metrics.indexedPages = inspections.indexedPages;
  else delete metrics.indexedPages;
  metrics.inspectionCache = inspections.inspectionCache;
  metrics.notes = metrics.notes.filter(
    (note) => note !== SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE,
  );
  if (inspections.indexedPages.length < metrics.pageUrls.length)
    metrics.notes.push(SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE);
}
