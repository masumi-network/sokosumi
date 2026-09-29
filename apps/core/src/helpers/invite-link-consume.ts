import type { Prisma } from "@sokosumi/database";

interface ConsumeInviteLinkArgs {
  id: string;
  now: Date;
  maxUses: number | null;
}

/**
 * Atomically reserve one use of an organization invite link: increment
 * `useCount` only if the link is still live (not revoked, not expired, and —
 * when capped — below `maxUses`). Returns true when a slot was consumed.
 * Race-safe via a conditional `updateMany`.
 */
export async function tryConsumeOrganizationInviteLink(
  args: ConsumeInviteLinkArgs,
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

/**
 * Atomically reserve one use of a chat-room guest invite link. Live if never
 * expires or still before hard expiry. Race-safe via a conditional `updateMany`.
 */
export async function tryConsumeChatRoomGuestInviteLink(
  args: ConsumeInviteLinkArgs,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const result = await tx.chatRoomGuestInviteLink.updateMany({
    where: {
      id: args.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: args.now } }],
      ...(args.maxUses !== null ? { useCount: { lt: args.maxUses } } : {}),
    },
    data: { useCount: { increment: 1 } },
  });
  return result.count === 1;
}
