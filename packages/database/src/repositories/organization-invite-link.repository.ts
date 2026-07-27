import type {
  OrganizationInviteLink,
  Prisma,
} from "../generated/prisma/client.js";

/**
 * Repository for shareable, email-agnostic organization invite links.
 * The link's `token` is the capability embedded in the /join/<token> URL;
 * anyone signed in who opens a live link can join the org as a member
 * (subject to the same billing gate as a normal invite accept).
 */
export const organizationInviteLinkRepository = (() => {
  async function createInviteLink(
    data: {
      token: string;
      organizationId: string;
      role: string;
      createdByUserId: string;
      expiresAt: Date;
      maxUses: number | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationInviteLink> {
    return await tx.organizationInviteLink.create({
      data: {
        token: data.token,
        organization: { connect: { id: data.organizationId } },
        role: data.role,
        createdBy: { connect: { id: data.createdByUserId } },
        expiresAt: data.expiresAt,
        maxUses: data.maxUses,
      },
    });
  }

  async function getInviteLinkByToken(
    token: string,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationInviteLink | null> {
    return await tx.organizationInviteLink.findUnique({ where: { token } });
  }

  /**
   * Atomically reserve one use of the link: increment `useCount` only if the
   * link is still live (not revoked, not expired, and — when capped — below
   * `maxUses`). Returns true when a slot was consumed, false when the link
   * became unusable concurrently. Race-safe via a conditional `updateMany`,
   * so two simultaneous joins can never exceed `maxUses`.
   */
  async function tryConsumeInviteLink(
    args: { id: string; now: Date; maxUses: number | null },
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.organizationInviteLink.updateMany({
      where: {
        id: args.id,
        revokedAt: null,
        expiresAt: { gt: args.now },
        ...(args.maxUses !== null ? { useCount: { lt: args.maxUses } } : {}),
      },
      data: { useCount: { increment: 1 } },
    });
    return result.count === 1;
  }

  async function revokeInviteLink(
    id: string,
    revokedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationInviteLink> {
    return await tx.organizationInviteLink.update({
      where: { id },
      data: { revokedAt },
    });
  }

  return {
    createInviteLink,
    getInviteLinkByToken,
    tryConsumeInviteLink,
    revokeInviteLink,
  };
})();
