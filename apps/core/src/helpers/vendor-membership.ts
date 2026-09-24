import type { Prisma } from "@sokosumi/database";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  hasAdminRole,
  requireUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

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
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const vendor = await tx.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true },
  });

  if (!vendor) {
    throw notFound("Vendor not found");
  }

  const membership = await tx.vendorMember.findFirst({
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
 * Vendor logo mint/cleanup gate: platform admin OR vendor admin membership.
 * Platform admins still get 404 when the vendor is missing.
 */
export async function requireVendorAdminOrPlatformAdmin(
  authContext: AuthenticationContext,
  vendorId: string,
): Promise<UserAuthenticationContext> {
  const userAuthContext = requireUserAuthContext(authContext);

  if (hasAdminRole(userAuthContext.role)) {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendor) {
      throw notFound("Vendor not found");
    }
    return userAuthContext;
  }

  await requireVendorAdminMembership(userAuthContext.userId, vendorId);
  return userAuthContext;
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

/**
 * Serialize membership changes with account deletion. Deletion writes each
 * Vendor row before it rechecks admin membership and cascades the user row, so
 * a change queued here behind it fails serialization and is retried.
 */
async function lockVendorMembershipMutation(
  vendorId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id"
    FROM "vendor"
    WHERE "id" = ${vendorId}::uuid
    FOR UPDATE
  `;
}

/**
 * Block removing or demoting the last vendor admin. `tx` is required and must
 * be the caller's Serializable write transaction. The Vendor row lock also
 * serializes this change with account deletion's in-transaction admin check.
 */
export async function assertCanChangeVendorMembership(
  vendorId: string,
  targetUserId: string,
  nextRole: "admin" | "developer" | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await lockVendorMembershipMutation(vendorId, tx);

  const membership = await tx.vendorMember.findFirst({
    where: { vendorId, userId: targetUserId },
    select: { role: true },
  });

  if (!membership) {
    throw notFound("Vendor member not found");
  }

  if (membership.role !== "admin" || nextRole === "admin") {
    return;
  }

  const adminCount = await tx.vendorMember.count({
    where: { vendorId, role: "admin" },
  });

  if (adminCount <= 1) {
    throw badRequest("Cannot remove or demote the last vendor admin");
  }
}
