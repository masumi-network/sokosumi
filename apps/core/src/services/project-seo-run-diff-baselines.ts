import type { Prisma, ProjectSeoObservation } from "@sokosumi/database";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import type { SeoRunDiffSource } from "./project-seo-run-diff";

/** Older checks of each kind loaded past a full evidence list: enough to find the check of the same Market. */
export const SEO_RUN_DIFF_BASELINES = 10;

/**
 * Checks older than a full evidence list, so the oldest checks in it still find the check to compare with. They feed
 * the comparison only: the timeline and the runs row show the evidence list alone.
 */
export async function loadSeoRunDiffBaselines(
  where: Prisma.ProjectSeoObservationWhereInput,
  evidence: ProjectSeoObservation[],
  limit: number,
): Promise<SeoRunDiffSource[]> {
  const oldest = evidence.at(-1);
  if (evidence.length < limit || !oldest) return [];
  const loaded = new Set(evidence.map((row) => row.id));
  const kinds = [...new Set(evidence.map((row) => row.kind))].filter(
    (kind) => kind !== "page_change",
  );
  const rows = await Promise.all(
    kinds.map((kind) =>
      prisma.projectSeoObservation.findMany({
        where: {
          ...where,
          ownerId: null,
          kind,
          // The same time as the oldest row: a row of that time can fall just outside the list.
          observedAt: { lte: oldest.observedAt },
        },
        orderBy: [
          { observedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: SEO_RUN_DIFF_BASELINES,
      }),
    ),
  );
  return rows.flat().flatMap((row) => {
    if (loaded.has(row.id)) return [];
    // A base is optional: an unreadable older check leaves the comparison without it.
    const payload = publicSeoPayloadSchema.safeParse(row.payload);
    return payload.success ? [{ ...row, payload: payload.data }] : [];
  });
}
