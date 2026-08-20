import type { ChatRoom } from "@/lib/clients/generated/core";

import { compareChatRoomsByRecentActivity } from "./chat-room-activity-sort";

export interface PartitionedSidebarRooms {
  namedChannels: ChatRoom[];
  directMessages: ChatRoom[];
  externalJoined: ChatRoom[];
}

/**
 * Split the unified room list for the chat sidebar.
 *
 * External channels (`discoverability === "external"`) — host members and
 * guests — live only under External, never under Channels, so they read as a
 * peer section next to Channels / Direct Messages. Personal human Directs
 * whose other human is not a Member of the active organization also sit here.
 */
export function partitionRoomsForSidebar(
  rooms: ChatRoom[],
): PartitionedSidebarRooms {
  const namedChannels: ChatRoom[] = [];
  const directMessages: ChatRoom[] = [];
  const externalJoined: ChatRoom[] = [];

  for (const room of rooms) {
    if (room.kind === "channel" && room.discoverability === "external") {
      externalJoined.push(room);
      continue;
    }

    // Guests are always on external rooms (DB invariant); keep as safety net.
    if (room.myAccess === "guest") {
      externalJoined.push(room);
      continue;
    }

    if (room.kind === "channel") {
      namedChannels.push(room);
      continue;
    }

    if (room.kind === "direct") {
      const isHumanPersonalDirect =
        room.organizationId === null && room.coworkerMembers.length === 0;
      if (isHumanPersonalDirect && !room.peerInActiveOrganization) {
        externalJoined.push(room);
      } else {
        directMessages.push(room);
      }
    }
  }

  // Unmuted → pinned → public → private → muted; activity within bucket.
  namedChannels.sort(compareChatRoomsByRecentActivity);
  directMessages.sort(compareChatRoomsByRecentActivity);
  externalJoined.sort(compareChatRoomsByRecentActivity);

  return { namedChannels, directMessages, externalJoined };
}
