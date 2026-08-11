import type {
  ChatRoomGuestInviteLink,
  Prisma,
} from "../generated/prisma/client.js";

/**
 * Repository for shareable, email-agnostic external-channel guest invite links.
 * The link's `token` is the capability embedded in `/chat/join/<token>`;
 * anyone signed in who is not a host-org member may claim as `access=guest`.
 */
export const chatRoomGuestInviteLinkRepository = (() => {
  async function createInviteLink(
    data: {
      token: string;
      roomId: string;
      createdByUserId: string;
      /** Null = no hard expiry. */
      expiresAt: Date | null;
      maxUses: number | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<ChatRoomGuestInviteLink> {
    return await tx.chatRoomGuestInviteLink.create({
      data: {
        token: data.token,
        room: { connect: { id: data.roomId } },
        createdBy: { connect: { id: data.createdByUserId } },
        expiresAt: data.expiresAt,
        maxUses: data.maxUses,
      },
    });
  }

  async function getInviteLinkByToken(
    token: string,
    tx: Prisma.TransactionClient,
  ): Promise<ChatRoomGuestInviteLink | null> {
    return await tx.chatRoomGuestInviteLink.findUnique({ where: { token } });
  }

  /**
   * Atomically reserve one use of the link: increment `useCount` only if the
   * link is still live (not revoked, not expired, and — when capped — below
   * `maxUses`). Returns true when a slot was consumed, false when the link
   * became unusable concurrently.
   */
  async function tryConsumeInviteLink(
    args: { id: string; now: Date; maxUses: number | null },
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.chatRoomGuestInviteLink.updateMany({
      where: {
        id: args.id,
        revokedAt: null,
        // Live if never expires or still before hard expiry.
        OR: [{ expiresAt: null }, { expiresAt: { gt: args.now } }],
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
  ): Promise<ChatRoomGuestInviteLink> {
    return await tx.chatRoomGuestInviteLink.update({
      where: { id },
      data: { revokedAt },
    });
  }

  async function listInviteLinksByRoomId(
    roomId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ChatRoomGuestInviteLink[]> {
    return await tx.chatRoomGuestInviteLink.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Count links that still block convert-off-external: not revoked and not past
   * expiresAt. Depleted links still count (token exists until expiry/revoke).
   */
  async function countLiveInviteLinksByRoomId(
    roomId: string,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return await tx.chatRoomGuestInviteLink.count({
      where: {
        roomId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  async function countRecentCreatesByUser(
    createdByUserId: string,
    since: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return await tx.chatRoomGuestInviteLink.count({
      where: {
        createdByUserId,
        createdAt: { gte: since },
      },
    });
  }

  return {
    createInviteLink,
    getInviteLinkByToken,
    tryConsumeInviteLink,
    revokeInviteLink,
    listInviteLinksByRoomId,
    countLiveInviteLinksByRoomId,
    countRecentCreatesByUser,
  };
})();
