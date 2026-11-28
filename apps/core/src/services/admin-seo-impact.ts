import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { impactWindowReadyOn } from "@/lib/seo/impact-window";
import {
  ADMIN_SEO_IMPACT_LIMIT,
  type adminSeoImpactQuery,
  adminSeoImpactVerdicts,
  SEO_IMPACT_STATES,
  seoImpactClosingCheck,
} from "@/schemas/seo-impact.schema";

const DAY_MS = 86_400_000;

const dateOnly = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

const closingChecks = z.array(seoImpactClosingCheck);

/** Every tracked page change across customers, newest change first. */
export async function listAdminSeoImpactVerdicts(
  { period, state, source }: z.output<typeof adminSeoImpactQuery>,
  now: Date = new Date(),
) {
  const scope: Prisma.ProjectSeoImpactVerdictWhereInput = {
    ...(period !== "all" && {
      changedAt: { gte: new Date(now.getTime() - Number(period) * DAY_MS) },
    }),
    ...(source && { changeSource: source }),
  };
  // One snapshot: a state change between the reads would split counts from rows.
  const [groups, rows] = await prisma.$transaction(
    [
      prisma.projectSeoImpactVerdict.groupBy({
        by: ["state"],
        where: scope,
        _count: { _all: true },
      }),
      prisma.projectSeoImpactVerdict.findMany({
        where: { ...scope, ...(state && { state }) },
        orderBy: { changedAt: "desc" },
        take: ADMIN_SEO_IMPACT_LIMIT,
        select: {
          id: true,
          projectId: true,
          pageUrl: true,
          changeSource: true,
          closingEvidence: true,
          changedAt: true,
          crawledAt: true,
          windowStart: true,
          windowEnd: true,
          state: true,
          reason: true,
          title: true,
          project: {
            select: {
              name: true,
              workspace: {
                select: { organization: { select: { slug: true } } },
              },
            },
          },
        },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  const counts = SEO_IMPACT_STATES.map((name) => ({
    state: name,
    count: groups.find((group) => group.state === name)?._count._all ?? 0,
  }));
  const checks = rows.map((row) =>
    row.changeSource === "audit_recheck"
      ? (closingChecks.safeParse(row.closingEvidence).data ?? [])
      : [],
  );
  const observationIds = [
    ...new Set(
      checks.flatMap((entries) =>
        entries.flatMap((entry) => [
          entry.baselineObservationId,
          entry.checkedObservationId,
        ]),
      ),
    ),
  ];
  const observations = observationIds.length
    ? await prisma.projectSeoObservation.findMany({
        where: { id: { in: observationIds } },
        select: { id: true, observedAt: true, projectId: true },
      })
    : [];
  const observationById = new Map(observations.map((item) => [item.id, item]));

  return adminSeoImpactVerdicts.parse({
    total: state
      ? (counts.find((item) => item.state === state)?.count ?? 0)
      : groups.reduce((sum, group) => sum + group._count._all, 0),
    counts,
    rows: rows.map((row, index) => {
      const windowEnd = dateOnly(row.windowEnd);
      const closingEvidence = checks[index].flatMap((check) => {
        const baseline = observationById.get(check.baselineObservationId);
        const checked = observationById.get(check.checkedObservationId);
        if (
          baseline?.projectId !== row.projectId ||
          checked?.projectId !== row.projectId
        ) {
          return [];
        }
        return [
          {
            rowId: check.rowId,
            device: check.device,
            baselineObservedAt: baseline.observedAt.toISOString(),
            checkedObservedAt: checked.observedAt.toISOString(),
          },
        ];
      });
      return {
        id: row.id,
        organizationSlug: row.project.workspace.organization?.slug ?? null,
        projectId: row.projectId,
        projectName: row.project.name,
        pageUrl: row.pageUrl,
        suggestionTitle: row.title,
        changeSource: row.changeSource,
        changedAt: row.changedAt.toISOString(),
        closingEvidence: closingEvidence.length
          ? [
              ...new Map(
                closingEvidence.map((entry) => [JSON.stringify(entry), entry]),
              ).values(),
            ]
          : null,
        crawledAt: row.crawledAt?.toISOString() ?? null,
        windowStart: dateOnly(row.windowStart),
        windowEnd,
        windowReadyOn: windowEnd ? impactWindowReadyOn(windowEnd) : null,
        state: row.state,
        reason: row.reason,
      };
    }),
  });
}
