import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { SEO_RANK_POINT_KINDS, seoRankPoints } from "./project-seo-rank-points";

/** Results per step. A full audit's payload holds up to 10 page Reports, so a step stays small. */
const BATCH = 50;

/**
 * Writes the rank points of the results imported before the import wrote them. Safe to run again and beside
 * live imports: a point that exists is left as it is. With `dryRun` it writes nothing and counts the missing
 * points.
 */
export async function backfillSeoRankPoints(
  options: { dryRun?: boolean } = {},
): Promise<{ results: number; unreadable: number; points: number }> {
  const count = { results: 0, unreadable: 0, points: 0 };
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.projectSeoObservation.findMany({
      // Public results only, as the import writes them: a private row holds no keyword reads.
      where: { kind: { in: SEO_RANK_POINT_KINDS }, ownerId: null },
      select: { id: true, payload: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(after && { cursor: { id: after }, skip: 1 }),
    });
    if (!rows.length) return count;
    after = rows.at(-1)?.id;
    for (const row of rows) {
      count.results += 1;
      // The history leaves an unreadable result out. So does this.
      const parsed = publicSeoPayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        count.unreadable += 1;
        continue;
      }
      const data = seoRankPoints(row.id, parsed.data);
      if (!data.length) continue;
      count.points += options.dryRun
        ? // A result's points are written together and never change: the missing ones are the rest.
          data.length -
          (await prisma.projectSeoRankPoint.count({
            where: { observationId: row.id },
          }))
        : (
            await prisma.projectSeoRankPoint.createMany({
              data,
              skipDuplicates: true,
            })
          ).count;
    }
  }
}
