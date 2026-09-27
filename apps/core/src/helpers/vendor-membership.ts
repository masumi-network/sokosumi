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
 * Account deletion's half of the handshake with
 * `lockVendorMembershipMutation`. Call inside the deletion transaction before
 * rechecking the last-admin rule.
 *
 * Writes (not only locks) every Vendor row the user belongs to, in stable
 * order. A membership change locks the same row first thing in a Serializable
 * transaction whose snapshot predates the wait; after a mere FOR UPDATE here it
 * would proceed on that stale snapshot, but after a committed write Postgres
 * aborts it and `serializableTransaction` retries on current data. The write
 * bumps `Vendor.updatedAt`.
 *
 * Then revokes pending invites to Vendors the user alone administers: once
 * accepted they would add a member to a Vendor left without an admin. A
 * concurrent accept either commits first, and the recheck sees the new member,
 * or waits on the invite row and fails serialization after deletion commits.
 */
export async function prepareVendorsForMemberDeletion(
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const memberships = await tx.vendorMember.findMany({
    where: { userId },
    select: { vendorId: true },
    orderBy: { vendorId: "asc" },
  });
  for (const { vendorId } of memberships) {
    await tx.vendor.update({
      where: { id: vendorId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }

  await tx.vendorMemberInvite.updateMany({
    where: {
      status: "PENDING",
      vendor: {
        vendorMembers: {
          some: { userId, role: "admin" },
          none: { userId: { not: userId }, role: "admin" },
        },
      },
    },
    data: { status: "REVOKED", resolvedAt: new Date() },
  });
}

/**
 * Serialize membership changes with account deletion; see
 * `prepareVendorsForMemberDeletion` for the deletion side.
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
