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

/** Each audit reads about 90 days, so the newest 30 audits reach back far enough for a 28-day window. */
const IMPACT_SERIES_AUDITS = 30;

/**
 * Add the before and after of each done action from the daily rows of its page alone.
 * An action whose page has no such rows gets no impact: the audit's combined
 * statistics of several pages are never credited to one of them.
 */
export async function withSeoActionImpact(
  actor: SeoActor,
  actions: ProjectSeoWorkspace["actions"],
  now = new Date(),
): Promise<ProjectSeoWorkspace["actions"]> {
  if (!actions.some((action) => action.completedAt || action.verifiedAt))
    return actions;
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: AUDIT_PAGE_SERIES_KIND,
      ownerId: actor.userId,
      visibility: "PRIVATE",
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
    const impact = series && seoActionImpact(action, series, now);
    return impact ? { ...action, impact } : action;
  });
}
