import type { Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * When a user becomes a host-org Member, promote any guest rows they hold on
 * that org's channels to `access=member`. Prevents dual guest+Member state.
 * No-op when they have no guest memberships.
 */
export async function upgradeGuestChatRoomMembershipsToMember(
  userId: string,
  organizationId: string,
  db: DbClient = prisma,
): Promise<number> {
  const result = await db.chatRoomUserMember.updateMany({
    where: {
      userId,
      access: CHAT_ROOM_ACCESS.GUEST,
      room: {
        organizationId,
        kind: "channel",
      },
    },
    data: { access: CHAT_ROOM_ACCESS.MEMBER },
  });
  return result.count;
}

/**
 * When a user leaves (or is removed from) a host org, demote their
 * `access=member` rows on that org's **external** channels back to guest so
 * they keep channel-only access without host powers / org gate breakage.
 * Public/private room memberships are left alone (still require org Member).
 */
export async function demoteExternalChatRoomMembershipsToGuest(
  userId: string,
  organizationId: string,
  db: DbClient = prisma,
): Promise<number> {
  const result = await db.chatRoomUserMember.updateMany({
    where: {
      userId,
      access: CHAT_ROOM_ACCESS.MEMBER,
      room: {
        organizationId,
        kind: "channel",
        discoverability: "external",
      },
    },
    data: { access: CHAT_ROOM_ACCESS.GUEST },
  });
  return result.count;
}
