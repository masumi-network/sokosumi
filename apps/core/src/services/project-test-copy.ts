import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";

/**
 * What every Project feature may ask about a CMO test copy (ADR 0073),
 * without loading CMO's services: the mark is the Project's.
 */

/** Whether this person made the test copy that is this Project's Cuso. */
export async function madeTestCopy(
  userId: string,
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      testCopyOfProjectId: { not: null },
      sokoBots: { some: { createdByUserId: userId } },
    },
    select: { testCopyOfProjectId: true },
  });
  return typeof project?.testCopyOfProjectId === "string";
}
