import prisma from "@/lib/db/prisma";
import {
  discoveryChanges,
  inspectionDiscoverySources,
  readSubmittedSitemaps,
} from "@/lib/seo/audit-sitemaps";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
} from "@/schemas/project-seo-native-metrics.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import {
  type AuditDiscovery,
  auditIndexReadSchema,
} from "@/schemas/seo-sitemap-evidence.schema";
import { seoOwnerWhere } from "./project-seo-store";

export async function collectAuditDiscovery(
  actor: SeoActor,
  taskId: string,
  metrics: NativeSeoMetrics,
  sources: ReadonlyMap<string, ReturnType<typeof inspectionDiscoverySources>>,
  read: (args: Record<string, unknown>) => Promise<unknown>,
  saved?: AuditDiscovery,
): Promise<AuditDiscovery> {
  const retained = saved?.status !== "unavailable" ? saved : undefined;
  const inventory =
    retained ?? (await readSubmittedSitemaps(metrics.propertyId, read));
  const checkedAt = retained?.checkedAt ?? new Date().toISOString();
  const current: AuditDiscovery = {
    ...inventory,
    checkedAt,
    inspections: [],
    changes: [],
  };
  for (const page of metrics.indexedPages ?? []) {
    const old = saved?.inspections.find(
      (row) =>
        row.page === page.pageUrl &&
        row.checkedAt === metrics.inspectionCache?.checkedAt[page.pageUrl],
    );
    const parsed = auditIndexReadSchema.safeParse({
      page: page.pageUrl,
      reason: page.coverageState,
      verdict: page.verdict,
      ...old,
      ...sources.get(page.pageUrl),
      canonical: page.googleCanonical,
      crawledAt: page.lastCrawlTime,
      checkedAt: metrics.inspectionCache?.checkedAt[page.pageUrl],
    });
    if (parsed.success) current.inspections.push(parsed.data);
  }
  const key = metrics.inspectionCache?.key;
  if (!key) return current;
  const priorBefore = async (before: string) => {
    const prior = await prisma.projectSeoObservation.findFirst({
      where: {
        ...seoOwnerWhere(actor),
        ownerId: actor.userId,
        kind: AUDIT_PERFORMANCE_KIND,
        source: "search_console",
        visibility: "PRIVATE",
        sourceTaskId: { not: taskId },
        observedAt: { lt: new Date(before.slice(0, 10)) },
        payload: { path: ["inspectionCache", "key"], equals: key },
        OR: ["available", "partial", "unavailable"].map((status) => ({
          payload: { path: ["auditDiscovery", "status"], equals: status },
        })),
      },
      select: { payload: true },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    });
    const previous = nativeSeoMetricsSchema.safeParse(prior?.payload).data;
    return previous?.propertyId === metrics.propertyId &&
      previous.inspectionCache?.key === key
      ? previous.auditDiscovery
      : undefined;
  };
  const previous = await priorBefore(checkedAt);
  const oldest =
    previous &&
    current.sitemaps.some(
      (row) =>
        row.webUrls !== null &&
        previous.sitemaps.some(
          (old) =>
            old.path === row.path &&
            old.webUrls !== null &&
            row.webUrls !== old.webUrls,
        ),
    )
      ? await priorBefore(previous.checkedAt)
      : undefined;
  current.changes = discoveryChanges(current, previous, oldest);
  return current;
}
