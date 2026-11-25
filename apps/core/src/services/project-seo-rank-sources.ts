import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import {
  SEO_RANK_HISTORY_KINDS,
  SEO_RANK_HISTORY_OBSERVATIONS,
  SEO_RANK_POINT_LOAD,
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

/** Keys one query names. PostgreSQL takes 32,767 bound values in a statement. */
const KEY_CHUNK = 5_000;

/**
 * The stored position reads of the given keys in the period, from this owner's public results, newest first.
 * At most `limit` per query. `limited`: a query held more, so older reads are missing.
 */
export async function loadSeoRankPoints(
  actor: SeoActor,
  keys: string[],
  period: Pick<SeoWorkspaceQuery, "from" | "to">,
  limit = SEO_RANK_POINT_LOAD,
): Promise<{ rows: SeoRankPointRow[]; limited: boolean }> {
  const observedAt = seoRankPeriodWhere(period);
  const rows: SeoRankPointRow[] = [];
  let limited = false;
  for (let start = 0; start < keys.length; start += KEY_CHUNK) {
    const found = await prisma.projectSeoRankPoint.findMany({
      where: {
        key: { in: keys.slice(start, start + KEY_CHUNK) },
        // The period reads the result's time, as every other part of the workspace does.
        observation: {
          ...seoOwnerWhere(actor),
          ownerId: null,
          ...(observedAt && { observedAt }),
        },
      },
      select: {
        key: true,
        observationId: true,
        observedAt: true,
        position: true,
        positionStatus: true,
        checkedResults: true,
        device: true,
      },
      orderBy: { observedAt: "desc" },
      // One more than the history reads: it says that older points exist.
      take: limit + 1,
    });
    limited ||= found.length > limit;
    rows.push(...found.slice(0, limit));
  }
  return { rows, limited };
}
