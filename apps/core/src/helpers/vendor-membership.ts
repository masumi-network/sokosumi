import type { Prisma } from "@sokosumi/database";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export function buildAccessibleCoworkerMembershipOr(
  userId: string,
): Prisma.CoworkerWhereInput[] {
  return [
    {
      vendor: {
        vendorMembers: {
          some: {
            userId,
            role: "admin",
          },
        },
      },
    },
    {
      assignments: {
        some: {
          userId,
        },
      },
    },
  ];
}

export function buildAccessibleCoworkersWhere(
  userId: string,
): Prisma.CoworkerWhereInput {
  return {
    OR: buildAccessibleCoworkerMembershipOr(userId),
  };
}

export async function requireVendorAdminMembership(
  userId: string,
  vendorId: string,
): Promise<void> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true },
  });

  if (!vendor) {
    throw notFound("Vendor not found");
  }

  const membership = await prisma.vendorMember.findFirst({
    where: {
      vendorId,
      userId,
      role: "admin",
    },
    select: { id: true },
  });

  if (!membership) {
    throw forbidden("Vendor admin access required");
  }
}

/**
 * Assignment targets: vendor admin or developer. Admin is a member with more
 * vendor permissions and may still be assigned to a coworker.
 */
export async function requireAssignableVendorMembership(
  userId: string,
  vendorId: string,
): Promise<void> {
  const membership = await prisma.vendorMember.findFirst({
    where: {
      vendorId,
      userId,
      role: {
        in: ["admin", "developer"],
      },
    },
    select: { id: true },
  });

  if (!membership) {
    throw badRequest("Target user must be a member of this vendor");
  }
}

export async function requireCoworkerBelongsToVendor(
  coworkerId: string,
  vendorId: string,
): Promise<void> {
  const coworker = await prisma.coworker.findFirst({
    where: {
      id: coworkerId,
      vendorId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }
}
