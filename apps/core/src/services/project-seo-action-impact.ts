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
import {
  normalizeSeoUrl,
  seoLinkedTaskWhere,
  seoOwnerWhere,
} from "./project-seo-store";

/** Each audit holds over a year of days per page, so each page needs only its newest few audits. */
const IMPACT_SERIES_AUDITS = 6;

/**
 * Add the before and after of each done action from the daily rows of its page alone.
 * An action whose page has no such rows gets no impact: the audit's combined
 * statistics of several pages are never credited to one of them.
 *
 * The rows follow their audit Task: a member reads the rows of a public audit a
 * colleague requested. The colleague's Google connection stays their own.
 * `ownerId` narrows the rows to the ones a single person collected.
 */
export async function withSeoActionImpact(
  actor: SeoActor,
  actions: ProjectSeoWorkspace["actions"],
  { days, ownerId }: { days?: number; ownerId?: string } = {},
  now = new Date(),
): Promise<ProjectSeoWorkspace["actions"]> {
  const done = actions.filter(
    (action) => action.completedAt || action.verifiedAt,
  );
  if (!done.length) return actions;
  const pages = await prisma.projectSeoPage.findMany({
    where: {
      ...seoOwnerWhere(actor),
      url: { in: done.map((action) => normalizeSeoUrl(action.pageUrl)) },
    },
    select: { id: true },
  });
  if (!pages.length) return actions;
  const stored = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: AUDIT_PAGE_SERIES_KIND,
      sourceTaskId: { not: null },
      pageIds: { hasSome: pages.map((page) => page.id) },
      ...(ownerId && { ownerId }),
    },
    select: { id: true, pageIds: true, sourceTaskId: true },
  });
  // The Tasks are checked here, not taken from the report list: that list holds only the newest checks.
  // Newest audit first, by when its Task began: a later retry of an older audit does not make it newer.
  const visible = new Map(
    (
      await prisma.task.findMany({
        where: {
          id: { in: stored.flatMap((row) => row.sourceTaskId ?? []) },
          ...seoLinkedTaskWhere(actor, true),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      })
    ).map((task, rank) => [task.id, rank]),
  );
  const audits = stored
    .filter((row) => row.sourceTaskId && visible.has(row.sourceTaskId))
    .sort(
      (a, b) => visible.get(a.sourceTaskId!)! - visible.get(b.sourceTaskId!)!,
    );
  const rank = new Map(audits.map((row, index) => [row.id, index]));
  // The limit counts per page: many audits of one page must not hide the only audit of another.
  const wanted = new Set<string>();
  for (const { id } of pages)
    for (const audit of audits
      .filter((row) => row.pageIds.includes(id))
      .slice(0, IMPACT_SERIES_AUDITS))
      wanted.add(audit.id);
  const rows = (
    await prisma.projectSeoObservation.findMany({
      where: { id: { in: [...wanted] } },
      select: { id: true, payload: true },
    })
  ).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
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
      held.series.push({
        from: page.from ?? data!.from,
        to: page.to ?? data!.to,
        days: page.days,
      });
      byPage.set(key, held);
    }
  }
  return actions.map((action) => {
    const series = byPage.get(normalizeSeoUrl(action.pageUrl))?.series;
    const impact = series && seoActionImpact(action, series, now, days);
    return impact ? { ...action, impact } : action;
  });
}
