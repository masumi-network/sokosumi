import type { Prisma } from "@sokosumi/database";

/**
 * Owner filters that `owner-filter-guard.test.ts` must reject, so the guard
 * is shown to fail on them, and a deliberate "without an Owner" filter it
 * must accept. Nothing imports or runs this file.
 */

interface WorkWhere {
  ownerId?: string | null | { not?: string | null };
  task?: WorkWhere;
}

declare function findWork(args: { where: WorkWhere }): void;

export function filterByMissingOwner(ownerId: string | undefined): void {
  findWork({ where: { ownerId } });
}

export function filterByNullableOwnerOfParentTask(
  ownerId: string | null,
): void {
  findWork({ where: { task: { ownerId: ownerId } } });
}

export function filterOutMissingOwner(ownerId: string | undefined): void {
  findWork({ where: { ownerId: { not: ownerId } } });
}

export function buildOptionalOwnerWhere(input: {
  ownerId?: string;
}): Prisma.TaskWhereInput {
  return { ownerId: input.ownerId };
}

/** Asks for work without an Owner on purpose; the guard accepts it. */
export function filterByNoOwner(): void {
  findWork({ where: { ownerId: null } });
  findWork({ where: { ownerId: { not: null } } });
}
