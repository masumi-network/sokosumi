import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import { SEO_RANK_HISTORY_POINTS } from "@/schemas/project-seo-rankings.schema";
import {
  SEO_RANK_HISTORY_KINDS,
  SEO_RANK_HISTORY_OBSERVATIONS,
  type SeoRankPointRow,
  type SeoRankSource,
} from "./project-seo-rankings";
import { seoOwnerWhere } from "./project-seo-store";

const DAY_MS = 86_400_000;

/**
 * The time range of a workspace period, as `matchesSeoPeriod` reads it: whole UTC days, both ends included.
 * Undefined without a period.
 */
export function seoRankPeriodWhere(
  period: Pick<SeoWorkspaceQuery, "from" | "to">,
) {
  if (!period.from && !period.to) return undefined;
  return {
    ...(period.from && { gte: new Date(`${period.from}T00:00:00.000Z`) }),
    ...(period.to && {
      lt: new Date(Date.parse(`${period.to}T00:00:00.000Z`) + DAY_MS),
    }),
  };
}

/**
 * The public results the SERP history reads, newest first, at most SEO_RANK_HISTORY_OBSERVATIONS of the period.
 */
export async function loadSeoRankSources(
  actor: SeoActor,
  pageIds: string[],
  period: Pick<SeoWorkspaceQuery, "from" | "to">,
): Promise<SeoRankSource[]> {
  const observedAt = seoRankPeriodWhere(period);
  return prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      pageIds: { hasSome: pageIds },
      ownerId: null,
      kind: { in: SEO_RANK_HISTORY_KINDS },
      // Prisma refuses an explicit undefined: no period, no key.
      ...(observedAt && { observedAt }),
    },
    select: { id: true, observedAt: true, payload: true },
    orderBy: { observedAt: "desc" },
    take: SEO_RANK_HISTORY_OBSERVATIONS,
  });
}

/**
 * The stored position reads of the given keys in the period, from this owner's public results. Per key, the
 * `perKey` newest and one more: the extra one says that older reads exist. A key's limit never depends on the
 * reads of another key.
 */
export async function loadSeoRankPoints(
  actor: SeoActor,
  keys: string[],
  period: Pick<SeoWorkspaceQuery, "from" | "to">,
  perKey = SEO_RANK_HISTORY_POINTS,
): Promise<SeoRankPointRow[]> {
  if (!keys.length) return [];
  const range = seoRankPeriodWhere(period);
  // Text, read as the column's own type: a zone conversion never moves the day bound.
  const from = range?.gte?.toISOString() ?? null;
  const before = range?.lt?.toISOString() ?? null;
  const owner = seoOwnerWhere(actor);
  // An equality on the owner's own column lets the owner index serve the join.
  const owned = owner.projectId
    ? Prisma.sql`o."projectId" = ${owner.projectId}::uuid AND o."auditId" IS NULL`
    : Prisma.sql`o."auditId" = ${owner.auditId}::uuid AND o."projectId" IS NULL`;
  // The period reads the result's time, as every other part of the workspace does.
  return prisma.$queryRaw<SeoRankPointRow[]>`
    SELECT "key", "observationId", "observedAt", "position", "positionStatus", "checkedResults", "device"
    FROM (
      SELECT p."key", p."observationId", p."observedAt", p."position", p."positionStatus",
        p."checkedResults", p."device",
        row_number() OVER (
          PARTITION BY p."key" ORDER BY p."observedAt" DESC, p."observationId" DESC
        ) AS "place"
      FROM ${sharedTable("project_seo_rank_point")} p
      JOIN ${sharedTable("project_seo_observation")} o ON o."id" = p."observationId"
      WHERE p."key" = ANY(${keys}::text[])
        AND o."ownerId" IS NULL
        AND ${owned}
        AND (${from}::timestamp IS NULL OR o."observedAt" >= ${from}::timestamp)
        AND (${before}::timestamp IS NULL OR o."observedAt" < ${before}::timestamp)
    ) ranked
    WHERE "place" <= ${perKey + 1}
  `;
}
