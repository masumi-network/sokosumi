import type { Prisma } from "@sokosumi/database";

/**
 * A Soko Bot that still belongs to `userId` and may run: not archived, not
 * paused by its owner. Callers that also honour an administrator pause add
 * `adminPausedAt: null` themselves.
 */
export function activeOwnedSokoBotWhere(
  sokoBotId: string,
  userId: string,
): Prisma.SokoBotWhereInput {
  return {
    id: sokoBotId,
    userId,
    archivedAt: null,
    status: { not: "PAUSED" },
  };
}
