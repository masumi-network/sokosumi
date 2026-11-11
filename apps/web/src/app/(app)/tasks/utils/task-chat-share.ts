import { type ChatRoom, ChatRoomAccess } from "@sokosumi/core-client";
import { taskChatRoomRefusal } from "@sokosumi/utils";

/**
 * The rooms the Send to chat dialog offers: those that take messages and
 * that Core's rule (`taskChatRoomRefusal`) would accept. Core applies the
 * same rule again at send time, so a room that changes meanwhile is refused.
 */
export function chatRoomsForTask(
  rooms: ChatRoom[],
  taskOrganizationId: string | null,
): ChatRoom[] {
  return rooms.filter(
    (room) =>
      !room.isReadOnly &&
      taskChatRoomRefusal(
        {
          kind: room.kind,
          organizationId: room.organizationId,
          discoverability: room.discoverability,
          isSelfDirect: room.isSelfDirect,
          hasAgentMembers:
            room.coworkerMembers.length > 0 || room.sokoBotMembers.length > 0,
          hasGuests: room.userMembers.some(
            (member) => member.access === ChatRoomAccess.GUEST,
          ),
        },
        taskOrganizationId,
      ) === null,
  );
}
