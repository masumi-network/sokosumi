import type { ChatRoom } from "@/lib/clients/generated/core";

import { compareChatRoomsByRecentActivity } from "./chat-room-activity-sort";

export interface PartitionedSidebarRooms {
  namedChannels: ChatRoom[];
  directMessages: ChatRoom[];
  externalJoined: ChatRoom[];
}

/**
 * Split the unified room list for the chat sidebar.
 * Guest rows (`myAccess === "guest"`) go only under External — never under
 * host Channels — so external channels do not look like normal org channels.
 */
export function partitionRoomsForSidebar(
  rooms: ChatRoom[],
): PartitionedSidebarRooms {
  const namedChannels: ChatRoom[] = [];
  const directMessages: ChatRoom[] = [];
  const externalJoined: ChatRoom[] = [];

  for (const room of rooms) {
    if (room.myAccess === "guest") {
      externalJoined.push(room);
      continue;
    }

    if (room.kind === "channel") {
      namedChannels.push(room);
      continue;
    }

    if (room.kind === "direct") {
      directMessages.push(room);
    }
  }

  // Unmuted → pinned → public → private → muted; activity within bucket.
  namedChannels.sort(compareChatRoomsByRecentActivity);
  directMessages.sort(compareChatRoomsByRecentActivity);
  externalJoined.sort(compareChatRoomsByRecentActivity);

  return { namedChannels, directMessages, externalJoined };
}
