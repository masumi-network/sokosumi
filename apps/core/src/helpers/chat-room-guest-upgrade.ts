import { NotificationKind, type Prisma } from "@sokosumi/database";

import { lockCalendarWorkspaceUserMembership } from "@/helpers/calendar-membership-fence";
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
  if (db === prisma) {
    return prisma.$transaction((tx) =>
      upgradeGuestChatRoomMembershipsToMember(userId, organizationId, tx),
    );
  }

  const guestMemberships = await db.chatRoomUserMember.findMany({
    where: {
      userId,
      access: CHAT_ROOM_ACCESS.GUEST,
      room: {
        organizationId,
        kind: "channel",
      },
    },
    select: { roomId: true },
  });
  const guestRoomIds = guestMemberships.map((membership) => membership.roomId);
  if (guestRoomIds.length === 0) {
    return 0;
  }

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { organizationId },
    select: { id: true },
  });
  // Member removal owns this row before it removes chat membership. Match that
  // order before touching chat rows, then keep the Calendar advisory fence
  // through notification scoping so neither transaction waits on the other.
  await lockCalendarWorkspaceUserMembership(db, workspace.id, userId);
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

  // Guest notifications deliberately have no organization scope. Once the
  // reader becomes a host member, scope their existing room previews too so
  // the Member FK and workspace cleanup remove them on a later organization
  // exit just like notifications created after the promotion.
  await db.notification.updateMany({
    where: {
      userId,
      kind: NotificationKind.CHAT,
      referenceId: { in: guestRoomIds },
      workspaceId: null,
      organizationId: null,
    },
    data: {
      workspaceId: workspace.id,
      organizationId,
    },
  });

  return result.count;
}
