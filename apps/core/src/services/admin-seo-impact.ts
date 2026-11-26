import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { impactWindowReadyOn } from "@/lib/seo/impact-window";
import {
  ADMIN_SEO_IMPACT_LIMIT,
  type adminSeoImpactQuery,
  adminSeoImpactVerdicts,
} from "@/schemas/seo-impact.schema";

const DAY_MS = 86_400_000;

const dateOnly = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

/** Every tracked page change across customers, newest change first. */
export async function listAdminSeoImpactVerdicts(
  { period }: z.output<typeof adminSeoImpactQuery>,
  now: Date = new Date(),
) {
  const where: Prisma.ProjectSeoImpactVerdictWhereInput =
    period === "all"
      ? {}
      : {
          changedAt: {
            gte: new Date(now.getTime() - Number(period) * DAY_MS),
          },
        };
  const [total, rows] = await Promise.all([
    prisma.projectSeoImpactVerdict.count({ where }),
    prisma.projectSeoImpactVerdict.findMany({
      where,
      orderBy: { changedAt: "desc" },
      take: ADMIN_SEO_IMPACT_LIMIT,
      select: {
        id: true,
        projectId: true,
        pageUrl: true,
        changeSource: true,
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
            workspace: { select: { organization: { select: { slug: true } } } },
          },
        },
      },
    }),
  ]);
  return adminSeoImpactVerdicts.parse({
    total,
    rows: rows.map((row) => {
      const windowEnd = dateOnly(row.windowEnd);
      return {
        id: row.id,
        organizationSlug: row.project.workspace.organization?.slug ?? null,
        projectId: row.projectId,
        projectName: row.project.name,
        pageUrl: row.pageUrl,
        suggestionTitle: row.title,
        changeSource: row.changeSource,
        changedAt: row.changedAt.toISOString(),
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
