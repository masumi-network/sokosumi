import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import {
  SEO_RANK_HISTORY_KINDS,
  SEO_RANK_HISTORY_OBSERVATIONS,
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
 * The public results the rank history reads, newest first, at most SEO_RANK_HISTORY_OBSERVATIONS of the period.
 * The period cuts in the query: cut after the load, a period older than the newest results came back empty.
 * `limited`: the period holds more results than the load takes, so older reads are missing.
 */
export async function loadSeoRankSources(
  actor: SeoActor,
  pageIds: string[],
  period: Pick<SeoWorkspaceQuery, "from" | "to">,
): Promise<{ rows: SeoRankSource[]; limited: boolean }> {
  const observedAt = seoRankPeriodWhere(period);
  const rows = await prisma.projectSeoObservation.findMany({
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
    // One more than the history reads: it says that older results exist.
    take: SEO_RANK_HISTORY_OBSERVATIONS + 1,
  });
  return {
    rows: rows.slice(0, SEO_RANK_HISTORY_OBSERVATIONS),
    limited: rows.length > SEO_RANK_HISTORY_OBSERVATIONS,
  };
}
