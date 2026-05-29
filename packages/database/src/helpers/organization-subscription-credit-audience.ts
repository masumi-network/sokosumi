import type { Prisma } from "../generated/prisma/client.js";
import { getSortedUniqueUserIds } from "./organization-seats.js";

export type OrganizationFreeCreditAudience =
  | { kind: "local_free_org"; memberUserIds: string[] }
  | { kind: "paid_org_unassigned_free"; memberUserIds: string[] };

export interface OrganizationSubscriptionCreditContext {
  stripeSubscriptionId: string | null;
}

export async function fetchOrganizationMemberUserIds(
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const members = await tx.member.findMany({
    where: {
      organizationId,
    },
    select: {
      userId: true,
    },
    orderBy: [{ userId: "asc" }],
  });

  return getSortedUniqueUserIds(members.map((member) => member.userId));
}

async function fetchUnassignedOrganizationMemberUserIds(
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const members = await tx.member.findMany({
    where: {
      organizationId,
      seatAssignedAt: null,
    },
    select: {
      userId: true,
    },
    orderBy: [{ userId: "asc" }],
  });

  return getSortedUniqueUserIds(members.map((member) => member.userId));
}

export async function resolveOrganizationFreeCreditAudience(
  organizationId: string,
  subscription: OrganizationSubscriptionCreditContext,
  tx: Prisma.TransactionClient,
): Promise<OrganizationFreeCreditAudience> {
  if (subscription.stripeSubscriptionId === null) {
    return {
      kind: "local_free_org",
      memberUserIds: await fetchOrganizationMemberUserIds(organizationId, tx),
    };
  }

  return {
    kind: "paid_org_unassigned_free",
    memberUserIds: await fetchUnassignedOrganizationMemberUserIds(
      organizationId,
      tx,
    ),
  };
}
