import type { Prisma } from "@sokosumi/database";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  hasAdminRole,
  requireUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

export interface VendorUserIdentity {
  userId?: string;
  email?: string;
}

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
 * Resolve an existing user from exactly one of `userId` or `email`.
 * Email match is case-insensitive.
 */
export async function resolveUserIdFromIdentity(
  identity: VendorUserIdentity,
): Promise<string> {
  if (identity.userId !== undefined && identity.email === undefined) {
    const user = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: { id: true },
    });
    if (!user) {
      throw notFound("User not found");
    }
    return user.id;
  }

  if (identity.email !== undefined && identity.userId === undefined) {
    const email = identity.email.trim();
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!user) {
      throw notFound("User not found");
    }
    return user.id;
  }

  throw badRequest("Provide exactly one of userId or email");
}

/**
 * Resolve a path segment that may be a user id or an email address.
 * Values containing `@` are treated as email (after URI decoding).
 */
export async function resolveUserIdFromUserIdOrEmail(
  userIdOrEmail: string,
): Promise<string> {
  const value = decodeURIComponent(userIdOrEmail).trim();
  if (value.includes("@")) {
    return resolveUserIdFromIdentity({ email: value });
  }
  return resolveUserIdFromIdentity({ userId: value });
}

/**
 * Block removing or demoting the last vendor admin.
 */
export async function assertCanRemoveOrDemoteVendorAdmin(
  vendorId: string,
  targetUserId: string,
): Promise<void> {
  const membership = await prisma.vendorMember.findFirst({
    where: { vendorId, userId: targetUserId },
    select: { role: true },
  });

  if (!membership) {
    throw notFound("Vendor member not found");
  }

  if (membership.role !== "admin") {
    return;
  }

  const adminCount = await prisma.vendorMember.count({
    where: { vendorId, role: "admin" },
  });

  if (adminCount <= 1) {
    throw badRequest("Cannot remove or demote the last vendor admin");
  }
}
