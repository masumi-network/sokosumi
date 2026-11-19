import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";

/**
 * What every Project feature may ask about a CMO test copy (ADR 0073),
 * without loading CMO's services: the mark is the Project's.
 */

/**
 * A test copy lives this long at most: Core tears down any that is older.
 */
export const TEST_COPY_LIFETIME_MS = 6 * 60 * 60 * 1_000;

/**
 * A test copy schedules no post sooner than this: twice the time it lives,
 * so its teardown cancels every post long before its time.
 */
export const TEST_COPY_SCHEDULE_FLOOR_MS = 2 * TEST_COPY_LIFETIME_MS;

export const TEST_COPY_SCHEDULE_FLOOR_MESSAGE =
  "A test copy schedules no post sooner than 12 hours ahead";

/** What a test copy answers to anything that would go out at once. */
export const TEST_COPY_NOTHING_AT_ONCE =
  "A test copy sends nothing at once: it never publishes, replies or spends";

/** The least time ahead a post of this Project may be scheduled. */
export function scheduleLeadMs(
  project: { testCopyOfProjectId: string | null },
  ordinaryLeadMs: number,
): number {
  return project.testCopyOfProjectId
    ? TEST_COPY_SCHEDULE_FLOOR_MS
    : ordinaryLeadMs;
}

/** Whether the Project is a test copy, torn down or not. */
export async function isTestCopyProject(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { testCopyOfProjectId: true },
  });
  return typeof project?.testCopyOfProjectId === "string";
}

/**
 * A test copy's family: its source Project and every copy of it, the copy
 * itself included. Null for a Project that is not a test copy.
 */
export async function testCopyFamilyProjectIds(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<string[] | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { testCopyOfProjectId: true },
  });
  const sourceProjectId = project?.testCopyOfProjectId;
  if (typeof sourceProjectId !== "string") return null;
  const copies = await db.project.findMany({
    where: { testCopyOfProjectId: sourceProjectId },
    select: { id: true },
  });
  return [sourceProjectId, ...copies.map((copy) => copy.id)];
}

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
