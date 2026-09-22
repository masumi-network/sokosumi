import type { Prisma } from "@sokosumi/database";

import { LIMITS, TIME } from "@/config/constants";
import { tooManyRequests } from "@/helpers/error";
import { vendorMemberInviteSchema } from "@/schemas/vendor.schema";

/** Vendor member invitation TTL matches org invitation expiry (7 days). */
export const VENDOR_INVITE_TTL_MS = TIME.INVITATION_EXPIRES * 1000;

/**
 * Normalize invitation emails for storage and lookup: trim + lowercase.
 * The partial unique index on live PENDING invites assumes normalized emails,
 * so member-add cannot distinguish `Dev@x.com` from `dev@x.com`.
 */
export function normalizeVendorInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Prisma `where` for pending invites that have not yet expired. Prefer this
 * over bare `status: PENDING` so TTL-dead rows do not block accept, rate
 * limits, or lists.
 */
export function livePendingVendorInviteWhere(
  vendorId: string,
  now: Date = new Date(),
): Prisma.VendorMemberInviteWhereInput {
  return {
    vendorId,
    status: "PENDING",
    expiresAt: { gt: now },
  };
}

/**
 * Mark past-due pending invites as expired (vendor-scoped or global).
 * Safe to call inside a transaction before count/create/list.
 */
export async function expireStaleVendorInvites(
  tx: Prisma.TransactionClient,
  options?: { vendorId?: string; now?: Date },
): Promise<number> {
  const now = options?.now ?? new Date();
  const result = await tx.vendorMemberInvite.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: now },
      ...(options?.vendorId ? { vendorId: options.vendorId } : {}),
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/**
 * Abuse caps for member invites: live pending per vendor + creates per
 * inviter/hour (across vendors). Call after {@link expireStaleVendorInvites}
 * for the vendor.
 */
export async function assertVendorInviteRateLimits(
  vendorId: string,
  inviterId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<void> {
  const pendingCount = await tx.vendorMemberInvite.count({
    where: livePendingVendorInviteWhere(vendorId, now),
  });
  if (pendingCount >= LIMITS.VENDOR_MEMBER_INVITE_PENDING_LIMIT) {
    throw tooManyRequests(
      `This vendor already has ${LIMITS.VENDOR_MEMBER_INVITE_PENDING_LIMIT} pending invitations. Revoke some before inviting more.`,
    );
  }

  const createWindowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const recentCreateCount = await tx.vendorMemberInvite.count({
    where: {
      invitedById: inviterId,
      createdAt: { gte: createWindowStart },
    },
  });
  if (recentCreateCount >= LIMITS.VENDOR_MEMBER_INVITE_CREATE_PER_HOUR) {
    throw tooManyRequests(
      `You can create at most ${LIMITS.VENDOR_MEMBER_INVITE_CREATE_PER_HOUR} vendor invitations per hour. Try again later.`,
    );
  }
}

export function vendorInviteExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + VENDOR_INVITE_TTL_MS);
}

/**
 * Public DTO for a vendor member invite. Carries only the email the caller
 * supplied plus invite metadata — never the invitee's user id or name, so the
 * response is identical whether or not the email maps to a registered account.
 */
export function mapVendorMemberInvite(invite: {
  id: string;
  vendorId: string;
  email: string;
  role: "admin" | "developer";
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "EXPIRED";
  expiresAt: Date;
  createdAt: Date;
}) {
  return vendorMemberInviteSchema.parse({
    id: invite.id,
    vendorId: invite.vendorId,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  });
}
