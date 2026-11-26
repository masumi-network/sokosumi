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
import { seoOwnerWhere } from "./project-seo-store";

/** Each audit holds over a year of days per page. An older audit only adds a page that the newer ones left out. */
const IMPACT_SERIES_AUDITS = 6;

/**
 * Add the before and after of each done action from the daily rows of its page alone.
 * An action whose page has no such rows gets no impact: the audit's combined
 * statistics of several pages are never credited to one of them.
 *
 * The rows follow their audit Task: `visibleTasks` holds the Tasks the reader may
 * see, so a member reads the rows of a public audit a colleague requested. The
 * colleague's Google connection stays their own.
 */
export async function withSeoActionImpact(
  actor: SeoActor,
  actions: ProjectSeoWorkspace["actions"],
  visibleTasks: ReadonlySet<string>,
  { days }: { days?: number } = {},
  now = new Date(),
): Promise<ProjectSeoWorkspace["actions"]> {
  if (!actions.some((action) => action.completedAt || action.verifiedAt))
    return actions;
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: AUDIT_PAGE_SERIES_KIND,
      sourceTaskId: { in: [...visibleTasks] },
    },
    orderBy: { observedAt: "desc" },
    take: IMPACT_SERIES_AUDITS,
    select: { payload: true },
  });
  const byPage = new Map<string, SeoImpactSeries[]>();
  for (const row of rows) {
    const data = auditPageSeriesSchema.safeParse(row.payload).data;
    for (const page of data?.pages ?? [])
      byPage.set(page.pageUrl, [
        ...(byPage.get(page.pageUrl) ?? []),
        { from: data!.from, to: data!.to, days: page.days },
      ]);
  }
  return actions.map((action) => {
    const series = byPage.get(action.pageUrl);
    const impact = series && seoActionImpact(action, series, now, days);
    return impact ? { ...action, impact } : action;
  });
}
