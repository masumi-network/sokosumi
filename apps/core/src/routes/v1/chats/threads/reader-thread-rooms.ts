import prisma from "@/lib/db/prisma";

import { membershipVisibleActiveRoomWhere } from "../rooms/helpers";

/**
 * The rooms whose Threads the Threads view reads (SOK-1159): the rooms the
 * sidebar lists for the reader, less the ones they muted. Room mute outranks
 * everything a room holds, so the sidebar shows no Thread of a muted room and
 * neither may the view, in either of its groups.
 */
export async function readerThreadRoomIds(
  userId: string,
  organizationId: string | null | undefined,
): Promise<string[]> {
  const rooms = await prisma.chatRoom.findMany({
    where: {
      ...membershipVisibleActiveRoomWhere(userId, organizationId),
      userMembers: { some: { userId, mutedAt: null } },
    },
    select: { id: true },
  });
  return rooms.map((room) => room.id);
}
