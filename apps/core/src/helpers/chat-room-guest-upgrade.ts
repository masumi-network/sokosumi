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
