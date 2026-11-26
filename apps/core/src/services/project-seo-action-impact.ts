import { type SeoImpactSeries, seoActionImpact } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import type {
  ProjectSeoWorkspace,
  SeoActor,
} from "@/schemas/project-seo.schema";
import {
  AUDIT_PAGE_SERIES_KIND,
  auditPageSeriesSchema,
} from "@/schemas/seo-action-impact.schema";
import { normalizeSeoUrl, seoOwnerWhere } from "./project-seo-store";

/** Each audit holds over a year of days per page. An older audit only adds a page that the newer ones left out. */
const IMPACT_SERIES_AUDITS = 6;

/**
 * Add the before and after of each done action from the daily rows of its page alone.
 * An action whose page has no such rows gets no impact: the audit's combined
 * statistics of several pages are never credited to one of them.
 *
 * The rows follow their audit Task: `visibleTasks` holds the Tasks the reader may
 * see, so a member reads the rows of a public audit a colleague requested. The
 * colleague's Google connection stays their own. `ownerId` narrows the rows to
 * the ones a single person collected.
 */
export async function withSeoActionImpact(
  actor: SeoActor,
  actions: ProjectSeoWorkspace["actions"],
  visibleTasks: ReadonlySet<string>,
  { days, ownerId }: { days?: number; ownerId?: string } = {},
  now = new Date(),
): Promise<ProjectSeoWorkspace["actions"]> {
  const done = actions.filter(
    (action) => action.completedAt || action.verifiedAt,
  );
  if (!done.length) return actions;
  // Only audits of a done action's page count toward the limit below.
  const pages = await prisma.projectSeoPage.findMany({
    where: {
      ...seoOwnerWhere(actor),
      url: { in: done.map((action) => normalizeSeoUrl(action.pageUrl)) },
    },
    select: { id: true },
  });
  if (!pages.length) return actions;
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: AUDIT_PAGE_SERIES_KIND,
      sourceTaskId: { in: [...visibleTasks] },
      pageIds: { hasSome: pages.map((page) => page.id) },
      ...(ownerId && { ownerId }),
    },
    orderBy: { observedAt: "desc" },
    take: IMPACT_SERIES_AUDITS,
    select: { payload: true },
  });
  const byPage = new Map<
    string,
    { source: string; series: SeoImpactSeries[] }
  >();
  for (const row of rows) {
    const data = auditPageSeriesSchema.safeParse(row.payload).data;
    for (const page of data?.pages ?? []) {
      const key = normalizeSeoUrl(page.pageUrl);
      // Google can move a page's traffic to another address. Rows of two addresses are never joined.
      const source = `${data!.propertyId} ${page.measuredUrl}`;
      const held = byPage.get(key) ?? { source, series: [] };
      if (held.source !== source) continue;
      held.series.push({ from: data!.from, to: data!.to, days: page.days });
      byPage.set(key, held);
    }
  }
  return actions.map((action) => {
    const series = byPage.get(normalizeSeoUrl(action.pageUrl))?.series;
    const impact = series && seoActionImpact(action, series, now, days);
    return impact ? { ...action, impact } : action;
  });
}
