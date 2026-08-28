import type { Prisma } from "../generated/prisma/client.js";
import { MemberRole } from "../types/organization.js";
import { resolvePurchasedSeats } from "./organization-seats.js";

function compareMembersForPaidSubscribeAssignment(
  left: { createdAt: Date; role: string },
  right: { createdAt: Date; role: string },
): number {
  if (left.role === MemberRole.OWNER && right.role !== MemberRole.OWNER) {
    return -1;
  }
  if (right.role === MemberRole.OWNER && left.role !== MemberRole.OWNER) {
    return 1;
  }
  return left.createdAt.getTime() - right.createdAt.getTime();
}

export async function autoAssignSeatsOnPaidSubscribe(
  organizationId: string,
  purchasedSeats: number | null | undefined,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const capacity = resolvePurchasedSeats(purchasedSeats);
  const members = await tx.member.findMany({
    where: { organizationId },
    select: {
      createdAt: true,
      id: true,
      role: true,
      seatAssignedAt: true,
    },
  });

  const ordered = members.toSorted(compareMembersForPaidSubscribeAssignment);
  let assignedCount = members.filter(
    (member) => member.seatAssignedAt != null,
  ).length;
  if (assignedCount > 0) {
    return 0;
  }
  let newlyAssigned = 0;

  for (const member of ordered) {
    if (assignedCount >= capacity) {
      break;
    }
    if (member.seatAssignedAt != null) {
      continue;
    }

    await tx.member.update({
      where: { id: member.id },
      data: { seatAssignedAt: new Date() },
    });
    assignedCount += 1;
    newlyAssigned += 1;
  }

  return newlyAssigned;
}

export async function unassignSeatsOverPurchasedCapacity(
  organizationId: string,
  purchasedSeats: number | null | undefined,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const capacity = resolvePurchasedSeats(purchasedSeats);
  const seated = await tx.member.findMany({
    where: {
      organizationId,
      seatAssignedAt: {
        not: null,
      },
    },
    select: {
      createdAt: true,
      id: true,
      seatAssignedAt: true,
    },
  });

  const assigned = seated.filter((member) => member.seatAssignedAt != null);
  const overflowCount = assigned.length - capacity;
  if (overflowCount <= 0) {
    return 0;
  }

  const overflow = assigned
    .toSorted((left, right) => {
      const createdAtDelta =
        right.createdAt.getTime() - left.createdAt.getTime();
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }
      return right.id.localeCompare(left.id);
    })
    .slice(0, overflowCount);

  for (const member of overflow) {
    await tx.member.update({
      where: { id: member.id },
      data: { seatAssignedAt: null },
    });
  }

  return overflow.length;
}
