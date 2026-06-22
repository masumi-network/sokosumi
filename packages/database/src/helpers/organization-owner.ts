import type { Prisma } from "../generated/prisma/client.js";
import { MemberRole } from "../types/organization.js";

export class OrganizationOwnerRetentionError extends Error {
  constructor() {
    super("Organization must have at least one owner");
    this.name = "OrganizationOwnerRetentionError";
  }
}

/**
 * Ensures an organization keeps at least one owner when demoting or removing
 * a member who is currently an owner.
 */
export async function assertOrganizationRetainsOwner(
  organizationId: string,
  targetMemberId: string,
  nextRole: MemberRole | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const targetMember = await tx.member.findFirst({
    where: {
      id: targetMemberId,
      organizationId,
    },
    select: {
      role: true,
    },
  });

  if (!targetMember) {
    throw new Error("Member not found");
  }

  if (targetMember.role !== MemberRole.OWNER) {
    return;
  }

  const isRemoval = nextRole === null;
  const isDemotion = nextRole !== null && nextRole !== MemberRole.OWNER;

  if (!isRemoval && !isDemotion) {
    return;
  }

  const otherOwnerCount = await tx.member.count({
    where: {
      organizationId,
      role: MemberRole.OWNER,
      id: {
        not: targetMemberId,
      },
    },
  });

  if (otherOwnerCount === 0) {
    throw new OrganizationOwnerRetentionError();
  }
}
